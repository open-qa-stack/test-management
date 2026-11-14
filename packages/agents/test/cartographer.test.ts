import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { CopilotAgentRuntime, ModelGateway } from "@open-qa-stack/harness";
import {
  validateConfig,
  validateDomainIndex,
  type DomainIndexSubmission,
  type MappedKnowledge,
  type ResolvedConfig,
  type SourceCard,
  type SourceCardSubmission,
} from "@open-qa-stack/shared";
import { answer, closedPort, scriptedServer, testSite, toolCalls, type ScriptedServer, type TestSite } from "@open-qa-stack/testing";
import { fingerprintOf, knowledgeInventory, type SqlClient } from "@open-qa-stack/tools";
import { Cartographer, INDEX_FILE_NAME, MAX_TRACED_LENGTH, type CartographyOutcome, type TraceLine } from "../src/index.ts";

const MODEL = "test-model";
const DB_URL = "postgresql://shop:s3cret-db-pass@127.0.0.1:5999/shop";
const TABLES = ["orders", "order_lines", "customers", "schema_migrations"];

const CONTRACT = {
  openapi: "3.0.3",
  info: { title: "Shop", version: "1" },
  paths: {
    "/orders": { get: { operationId: "listOrders", tags: ["orders"], responses: { "200": { description: "OK" } } } },
    "/customers": { get: { operationId: "listCustomers", tags: ["customers"], responses: { "200": { description: "OK" } } } },
    "/health": { get: { operationId: "health", responses: { "200": { description: "OK" } } } },
  },
};

/** A database that answers the catalog queries with fixed tables, and remembers every query. */
class CatalogDouble implements SqlClient {
  public readonly queries: string[] = [];
  private readonly tables: readonly string[];

  /** @param tables - Tables of the `public` schema. */
  public constructor(tables: readonly string[] = TABLES) {
    this.tables = tables;
  }

  /** {@inheritDoc SqlClient.query} */
  public async query(text: string): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
    this.queries.push(text);
    if (["pg_constraint", "pg_get_viewdef", "pg_get_functiondef", "pg_get_triggerdef"].some((part) => text.includes(part))) return { columns: [], rows: [] };
    if (text.includes("information_schema.tables")) return { columns: ["schema", "table"], rows: this.tables.map((table) => ({ schema: "public", table })) };
    return { columns: ["name", "type", "nullable"], rows: [{ name: "id", type: "bigint", nullable: false }] };
  }
}

let site: TestSite;
let elsewhere: TestSite;
let workspace: string;

before(async () => {
  elsewhere = await testSite({ "/": "<p>Elsewhere</p>" });
  site = await testSite({ "/": '<h1>Shop</h1><a href="/orders">Orders</a>', "/orders": "<h1>Orders</h1>" }, { "/broken": { status: 500, location: "/" } });
  workspace = mkdtempSync(join(tmpdir(), "oqas-cartographer-"));
});

after(async () => {
  await site.close();
  await elsewhere.close();
  rmSync(workspace, { recursive: true, force: true });
});

/** A fresh test repository with its contract and documents, under git, with one commit. */
function repository(): string {
  const root = mkdtempSync(join(workspace, "repo-"));
  mkdirSync(join(root, "contracts"));
  mkdirSync(join(root, "specs"));
  writeFileSync(join(root, "contracts", "shop.json"), JSON.stringify(CONTRACT));
  writeFileSync(join(root, "specs", "orders.md"), "# Orders\n\n## Placing an order\n\nA customer places an order.\n");
  writeFileSync(join(root, "specs", "returns.md"), "# Returns\n\nNot read.\n");
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      stdio: "pipe",
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" },
    });
  const remote = mkdtempSync(join(workspace, "remote-"));
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "Initial commit");
  git("remote", "add", "origin", remote);
  git("push", "-q", "origin", "main");
  git("fetch", "-q", "origin");
  return root;
}

/** HEAD and every reference of a repository and of its remote. */
function references(root: string): { readonly head: string; readonly local: string; readonly remote: string } {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  return { head: git(root, "rev-parse", "HEAD"), local: git(root, "for-each-ref"), remote: git(git(root, "remote", "get-url", "origin"), "for-each-ref") };
}

interface Setup {
  readonly uiUrl?: string;
  readonly limits?: { maxIterations: number; maxMinutes: number; maxActions: number };
  readonly documents?: readonly string[];
  readonly contractUrl?: string;
  readonly environment?: string;
  /** Reaches the base with the PostgreSQL client rather than the catalog double. */
  readonly realDatabase?: boolean;
  /** Runs at the autonomous level, with the system clock. */
  readonly autonomous?: boolean;
  /** Sources whose up-to-date card is in the repository before the run; all four by default. */
  readonly cards?: readonly string[];
  /** Receives each line of the trace as it is written. */
  readonly observe?: (line: TraceLine) => void;
  /** Maps every source again, and makes the index again. */
  readonly force?: boolean;
  /** Changes the repository once its cards are written, before the run. */
  readonly prepare?: (root: string) => void;
}

function configFor(modelUrl: string, setup: Setup = {}): ResolvedConfig {
  const attachments = [{ application: "shop" }];
  const knowledge = [
    setup.contractUrl === undefined
      ? { id: "shop-api", type: "openapi", path: "contracts/shop.json", attachments }
      : { id: "shop-api", type: "openapi", url: setup.contractUrl, attachments },
    { id: "shop-db", type: "postgresql", connectionStringEnv: "SHOP_DB_URL", attachments },
    ...(setup.documents ?? ["specs/orders.md"]).map((path, i) => ({
      id: i === 0 ? "order-specs" : `specs-${i}`,
      type: "document",
      path,
      attachments: i === 0 ? [{ application: "shop", environment: "local" }] : attachments,
    })),
    { id: "staging-specs", type: "document", path: "specs/returns.md", attachments: [{ application: "shop", environment: "staging" }] },
  ];
  const text = JSON.stringify({
    formatVersion: 1,
    applications: [
      {
        id: "shop",
        name: "Shop",
        type: "web",
        authentication: { method: "none" },
        environments: [
          { name: "local", uiUrl: setup.uiUrl ?? site.origin },
          { name: "staging", uiUrl: site.origin },
        ],
      },
      {
        id: "ledger",
        name: "Ledger",
        type: "api",
        authentication: { method: "none" },
        environments: [{ name: "local", apis: [{ name: "api", baseUrl: site.origin }] }],
      },
    ],
    knowledge,
    model: { mode: "provider-key", provider: "openai", baseUrl: modelUrl, model: MODEL },
    autonomy:
      setup.autonomous === true ? { level: "autonomous" } : { level: "bounded", task: setup.limits ?? { maxIterations: 20, maxMinutes: 10, maxActions: 200 } },
  });
  const result = validateConfig(text, { SHOP_DB_URL: DB_URL });
  assert.ok(result.ok, JSON.stringify(result));
  return result.config;
}

/** The elements of the card of each source, as the harness reads them. */
const ELEMENTS: Readonly<Record<string, readonly string[]>> = {
  "shop-api": ["orders", "customers", "/health"],
  "shop-db": TABLES.map((table) => `public.${table}`),
  "order-specs": ["Orders", "Placing an order"],
  shop: ["/", "/orders"],
};

/** The domain the agent of each source put each of its elements in; an element in none was set aside. */
const PLACED: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  "shop-api": { orders: ["orders"], customers: ["customers"] },
  "shop-db": { orders: ["public.orders", "public.order_lines"], customers: ["public.customers"] },
  "order-specs": { orders: ["Orders", "Placing an order"] },
  shop: { orders: ["/orders"] },
};

/** The card of a source, as its agent mapped it: its elements in the domains of its own, the others set aside. */
function cardSubmission(id: string): SourceCardSubmission {
  const placed = Object.values(PLACED[id]!).flat();
  return {
    domains: Object.entries(PLACED[id]!).map(([domain, items]) => ({
      id: domain,
      label: domain,
      description: `What ${id} holds of the ${domain}.`,
      items: items.map((name) => ({ name, summary: `About ${name}.` })),
    })),
    unassigned: ELEMENTS[id]!.filter((name) => !placed.includes(name)),
  };
}

/** Writes in the repository an up-to-date card of each source named. */
async function writeCards(root: string, config: ResolvedConfig, database: SqlClient, ids: readonly string[]): Promise<void> {
  mkdirSync(join(root, ".oqas", "index", "sources"), { recursive: true });
  for (const id of ids) {
    const knowledge = config.knowledge.find((source): source is MappedKnowledge => source.id === id && source.type !== "logs");
    const fingerprint =
      knowledge === undefined
        ? fingerprintOf(config.applications[0]!.environments[0]!.uiUrl!)
        : (await knowledgeInventory(knowledge, { repositoryRoot: root, env: { SHOP_DB_URL: DB_URL }, sqlClient: () => database })).fingerprint;
    const card: SourceCard = {
      formatVersion: 1,
      source: { id, type: knowledge?.type ?? "web" },
      fingerprint,
      producedAt: "2026-11-13T09:00:00.000Z",
      model: { provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: MODEL },
      run: { iterations: 9, actions: 9, durationMs: 9 },
      status: "complete",
      ...cardSubmission(id),
    };
    writeFileSync(join(root, ".oqas", "index", "sources", `${id}.json`), JSON.stringify(card));
  }
}

const SUBMISSION: DomainIndexSubmission = {
  domains: [
    {
      id: "orders",
      label: "Orders",
      description: "Placing and following an order.",
      references: [
        { source: "shop-api", items: ["orders"] },
        { source: "shop-db", items: ["public.orders", "public.order_lines"] },
        { source: "shop", items: ["/orders"] },
        { source: "order-specs", items: ["Orders", "Placing an order"] },
      ],
    },
    {
      id: "customers",
      label: "Customers",
      description: "The customers of the shop.",
      references: [
        { source: "shop-api", items: ["customers"] },
        { source: "shop-db", items: ["public.customers"] },
      ],
    },
  ],
  unassigned: [
    { source: "shop-api", items: ["/health"] },
    { source: "shop-db", items: ["public.schema_migrations"] },
    { source: "shop", items: ["/"] },
  ],
};

/** A domain of a source, as the orchestrator names it in a domain of the application. */
const from = (source: string, domain: string, items?: readonly string[]) => ({ source, domain, ...(items === undefined ? {} : { items }) });
/** What the orchestrator hands in to get `SUBMISSION`: the domains of the sources each domain of the application gathers. */
const MERGES = {
  domains: [
    {
      id: "orders",
      label: "Orders",
      description: "Placing and following an order.",
      from: [from("shop-api", "orders"), from("shop-db", "orders"), from("shop", "orders"), from("order-specs", "orders")],
    },
    { id: "customers", label: "Customers", description: "The customers of the shop.", from: [from("shop-api", "customers"), from("shop-db", "customers")] },
  ],
};

/** What the orchestrator hands in without the sources named: the domains of the application gather those of the others. */
function gathering(...left: string[]) {
  return { domains: MERGES.domains.map((domain) => ({ ...domain, from: domain.from.filter((part) => !left.includes(part.source)) })) };
}

/** What the orchestrator hands in for a shop whose interface was explored in the run: its home, the one domain of that map, goes with the orders. */
function explored() {
  const [orders, customers] = gathering("shop").domains;
  return { domains: [{ ...orders!, from: [...orders!.from, from("shop", "all")] }, customers!] };
}

/** The submission without any reference to the sources named. */
function without(...sources: string[]): DomainIndexSubmission {
  const kept = (references: DomainIndexSubmission["unassigned"]) => references.filter((r) => !sources.includes(r.source));
  return { domains: SUBMISSION.domains.map((domain) => ({ ...domain, references: kept(domain.references) })), unassigned: kept(SUBMISSION.unassigned) };
}

const submit = (submission: unknown, id = "x1") => ({ id, name: "submit_index", arguments: submission });
/** The calls of the agent that explores the shop once it opened its home: the home in a domain, and the orders its link leads to set aside. */
const HOME_MAPPED = [
  {
    id: "w1",
    name: "write_domain",
    arguments: {
      id: "all",
      label: "All",
      description: "Everything shop holds.",
      elements: [{ screen: "/", role: "About /." }],
      observations: [{ screen: "/", statement: "The home names the shop.", shows: ["Shop"] }],
      body: "`/`",
    },
  },
  { id: "a1", name: "set_aside", arguments: { elements: [{ screen: "/orders" }], reason: "Not opened in this run." } },
];

interface Run {
  readonly before: ReturnType<typeof references>;
  readonly outcome: CartographyOutcome;
  readonly server: ScriptedServer;
  readonly root: string;
  readonly database: CatalogDouble;
}

/** Runs a cartography against a scripted model, the cards of `setup.cards` already made, then stops the model server. */
async function cartography(
  replies: readonly { status?: number; body: unknown }[],
  setup: Setup = {},
  database = new CatalogDouble(),
  modelUrl?: string,
): Promise<Run> {
  const server = await scriptedServer(replies);
  const gateway = await ModelGateway.start({ kind: "live", upstream: { baseUrl: modelUrl ?? server.baseUrl } });
  const home = mkdtempSync(join(workspace, "home-"));
  const runtime = new CopilotAgentRuntime({ endpoint: gateway, model: MODEL, homeDirectory: home });
  const root = repository();
  const before = references(root);
  try {
    const config = configFor(server.baseUrl, setup);
    await writeCards(root, config, database, setup.cards ?? Object.keys(ELEMENTS));
    setup.prepare?.(root);
    const cartographer = new Cartographer({
      config,
      environment: setup.environment ?? "local",
      repositoryRoot: root,
      env: { SHOP_DB_URL: DB_URL },
      runtime,
      browser: { actionTimeoutMs: 1000, navigationTimeoutMs: 3000, settleTimeoutMs: 0 },
      ...(setup.realDatabase === true ? {} : { sqlClient: () => database }),
      ...(setup.autonomous === true ? {} : { now: () => new Date("2026-11-13T10:00:00.000Z") }),
      ...(setup.observe === undefined ? {} : { observe: setup.observe }),
      ...(setup.force === undefined ? {} : { force: setup.force }),
    });
    return { outcome: await cartographer.run(), server, root, database, before };
  } finally {
    await runtime.close();
    await gateway.close();
    await server.close();
  }
}

const happy = () => [{ body: toolCalls(MODEL, [submit(MERGES)]) }, { body: answer(MODEL, "Two domains: orders and customers.") }];
const messages = (outcome: CartographyOutcome) => outcome.journal.map((entry) => entry.message).join("\n");
const indexFile = (root: string) => join(root, ".oqas", "index", INDEX_FILE_NAME);
/** The fingerprint of the card of a source, as written in the repository: a digest of its JSON content. */
const cardPrint = (root: string, id: string) =>
  fingerprintOf(JSON.stringify(JSON.parse(readFileSync(join(root, ".oqas", "index", "sources", `${id}.json`), "utf8"))));
const toolsOffered = (server: ScriptedServer, request: number) =>
  (server.requests[request]!.body as { tools: { function: { name: string } }[] }).tools.map((tool) => tool.function.name);

describe("criterion 1 — the cartographer writes an index that passes the schema of the index format", () => {
  it("consolidates the domains of a contract, a base, a document and an interface into those of the application", async () => {
    const { outcome, root, server } = await cartography(happy());
    assert.equal(outcome.indexPath, indexFile(root));
    const written = JSON.parse(readFileSync(indexFile(root), "utf8")) as unknown;
    assert.deepEqual(validateDomainIndex(written), { ok: true, value: outcome.index });
    assert.deepEqual(outcome.index!.sources, [
      { id: "shop-api", type: "openapi", state: "read", cardFingerprint: cardPrint(root, "shop-api") },
      { id: "shop-db", type: "postgresql", state: "read", cardFingerprint: cardPrint(root, "shop-db") },
      { id: "order-specs", type: "document", state: "read", cardFingerprint: cardPrint(root, "order-specs") },
      { id: "shop", type: "web", state: "read", cardFingerprint: cardPrint(root, "shop") },
    ]);
    assert.deepEqual(
      [outcome.index!.status, outcome.index!.producedAt, outcome.index!.environment, outcome.index!.run.iterations],
      ["complete", "2026-11-13T10:00:00.000Z", "local", 2],
    );
    assert.ok(["read_source_domain", "recall", "remember", "submit_index"].every((tool) => toolsOffered(server, 0).includes(tool)));
    assert.match(
      messages(outcome),
      /The card of shop is up to date; it was kept\.\nThe index is made: no index could be read\.\nThe index was accepted\.\nThe index was written to .*domain-index\.json, complete\./,
    );
  });
});

describe("criterion 2 — every domain of every source is in a domain of the application, and its elements follow", () => {
  it("gives the orchestrator the domains of the sources, not their elements, with the tool that reads a map and the tools of the sources", async () => {
    const { outcome, server } = await cartography(happy());
    const request = (server.requests[0]!.body as { messages: { role: string; content: string }[] }).messages.find(
      (message) => message.role === "user",
    )!.content;
    assert.ok(
      request.includes("## shop-db (postgresql)\n- orders — orders: What shop-db holds of the orders. (2 elements, such as public.orders, public.order_lines)"),
      request,
    );
    assert.ok(request.includes("- Set aside by its agent: 1 elements."));
    assert.ok(!request.includes("About public.orders."), "the elements are read with a tool, not given");
    const offered = toolsOffered(server, 0);
    for (const tool of [
      "read_source_domain",
      "shop_api_list_operations",
      "shop_db_list_tables",
      "order_specs_read_section",
      "shop_goto",
      "remember",
      "recall",
      "submit_index",
    ])
      assert.ok(offered.includes(tool), tool);
    assert.deepEqual([outcome.index!.domains, outcome.index!.unassigned], [SUBMISSION.domains, SUBMISSION.unassigned]);
  });

  it("lets the orchestrator read the map of a source, and the source itself, before it hands the index in", async () => {
    const looks = [
      { id: "m1", name: "read_source_domain", arguments: { source: "shop-db", domain: "orders" } },
      { id: "t1", name: "shop_db_list_tables", arguments: {} },
      // The browser of the application is guarded as an exploration is: nothing that removes data is clicked.
      { id: "k1", name: "shop_click", arguments: { target: { role: "button", name: "Delete order" } } },
    ];
    const { outcome, server } = await cartography([{ body: toolCalls(MODEL, looks) }, ...happy()]);
    assert.equal(outcome.index!.status, "complete", messages(outcome));
    const told = JSON.stringify(server.requests[1]!.body);
    assert.match(told, /orders \(`orders`\)[^"]*`public\.orders`: About public\.orders\./);
    assert.match(told, /order_lines/);
    assert.match(told, /may remove data of the application, and an exploration never removes any/);
  });

  it("journals the error of a tool the orchestrator called wrongly", async () => {
    const wrong = [{ id: "m1", name: "read_source_domain", arguments: { source: "shop-db" } }];
    const { outcome } = await cartography([{ body: toolCalls(MODEL, wrong) }, ...happy()]);
    assert.match(messages(outcome), /read_source_domain: /);
  });
});

describe("criterion 3 — an index that leaves a domain of a source aside is not written, and the journal says so", () => {
  /** A submission that gathers the orders alone: the customers of the contract and of the base are left aside. */
  const partial = { domains: [MERGES.domains[0]!] };

  it("refuses the submission, tells the agent what is left, and writes nothing", async () => {
    const { outcome, root, server } = await cartography([{ body: toolCalls(MODEL, [submit(partial)]) }, { body: answer(MODEL, "Done.") }]);
    assert.equal(existsSync(indexFile(root)), false);
    assert.match(messages(outcome), /The index was refused: 2 domains of the sources are in no domain of the application\./);
    const told = JSON.stringify(server.requests[1]!.body);
    assert.match(told, /Still in no domain of the application/);
    assert.ok(told.includes("- shop-api › customers") && told.includes("- shop-db › customers"));
  });

  it("names the limit that stopped the consolidation before an index was accepted", async () => {
    const { outcome, root } = await cartography([{ body: toolCalls(MODEL, [submit(partial)]) }, { body: answer(MODEL, "Done.") }], {
      limits: { maxIterations: 1, maxMinutes: 10, maxActions: 200 },
    });
    assert.equal(existsSync(indexFile(root)), false);
    assert.equal(outcome.stoppedBy, "iterations");
  });

  it("stops reminding after three times, with the latest refusal each time", async () => {
    const { outcome, server } = await cartography([
      { body: toolCalls(MODEL, [submit(partial)]) },
      ...Array.from({ length: 4 }, () => ({ body: answer(MODEL, "Done.") })),
    ]);
    assert.equal(server.requests.length, 5);
    assert.match(JSON.stringify(server.requests[4]!.body), /Still in no domain of the application/);
    assert.equal(outcome.journal.filter((e) => e.message.startsWith("The agent stopped without an accepted index")).length, 3);
    assert.match(messages(outcome), /No index was written: no index was accepted before the session ended\./);
  });

  it("keeps as domains of the application of their own those left aside twice in a row, and writes the index", async () => {
    const { outcome } = await cartography([
      { body: toolCalls(MODEL, [submit(partial)]) },
      { body: toolCalls(MODEL, [submit(partial, "x2")]) },
      { body: answer(MODEL, "Done.") },
    ]);
    assert.deepEqual(
      outcome.index!.domains.map((domain) => [domain.id, domain.references.map((reference) => reference.source)]),
      [
        ["orders", ["shop-api", "shop-db", "shop", "order-specs"]],
        ["customers", ["shop-api", "shop-db"]],
      ],
    );
    assert.match(messages(outcome), /the harness kept each as a domain of the application: shop-api › customers, shop-db › customers\./);
  });
});

describe("criterion 4 — an index that breaks the schema is not written, and the journal names the field", () => {
  it("journals the field of a whole index that breaks the schema", async () => {
    const { outcome, root } = await cartography([{ body: toolCalls(MODEL, [submit(gathering("shop", "order-specs"))]) }, { body: answer(MODEL, "Done.") }], {
      environment: "",
    });
    assert.equal(existsSync(indexFile(root)), false);
    assert.match(messages(outcome), /The index does not match its schema: \/environment must NOT have fewer than 1 characters\.\nNo index was written\./);
  });
});

describe("criterion 5 — a declared source that does not answer stops the run before any exploration", () => {
  it("names each source in error and its cause, starts no session, writes nothing", async () => {
    const down = await closedPort();
    const failing: SqlClient = { query: () => Promise.reject("refused") };
    const { outcome, root, server } = await cartography(
      [],
      { uiUrl: `http://127.0.0.1:${down}`, documents: ["specs/missing.md"], cards: [] },
      failing as unknown as CatalogDouble,
    );
    assert.deepEqual(server.requests, []);
    assert.equal(existsSync(indexFile(root)), false);
    const errors = outcome.journal.filter((entry) => entry.source !== undefined).map((entry) => [entry.source, entry.message]);
    assert.deepEqual(
      errors.map(([source]) => source),
      ["shop-db", "order-specs", "shop"],
    );
    assert.match(errors[0]![1]!, /^The source shop-db does not answer: refused$/);
    assert.match(errors[1]![1]!, /^The source order-specs does not answer: The document specs\/missing\.md does not exist\./);
    assert.match(errors[2]![1]!, /^The source shop does not answer: fetch failed: .*ECONNREFUSED/);
    assert.match(messages(outcome), /No index was written: every declared source must answer before the exploration\./);
  });

  it("refuses a user interface that answers with a server error, and a contract that cannot be fetched", async () => {
    const down = await closedPort();
    const { outcome } = await cartography([], { uiUrl: `${site.origin}/broken`, contractUrl: `http://127.0.0.1:${down}/v3/api-docs`, cards: [] });
    assert.match(messages(outcome), /The source shop does not answer: .*\/broken answered with status 500\./);
    assert.match(messages(outcome), /The source shop-api does not answer: fetch failed/);
  });
});

describe("defaults of a run", () => {
  it("checks the base with PostgreSQL itself, and says when it does not answer", async () => {
    const { outcome, server } = await cartography(happy(), { realDatabase: true, cards: [] });
    assert.deepEqual(server.requests, []);
    assert.match(messages(outcome), /The source shop-db does not answer: The database query failed: .*ECONNREFUSED/);
  });

  it("runs without limits at the autonomous level, and dates the index with the system clock", async () => {
    const before = Date.now();
    const { outcome } = await cartography(happy(), { autonomous: true });
    assert.equal(outcome.index!.status, "complete");
    assert.ok(Date.parse(outcome.index!.producedAt) >= before);
  });
});

describe("criterion 6 — a navigation outside the declared origins is refused, counted and journaled", () => {
  it("answers the agent of the interface with an error, reaches no other host, and counts the action in the index", async () => {
    const away = [{ id: "g1", name: "shop_goto", arguments: { url: `${elsewhere.origin}/` } }];
    const home = [{ id: "g2", name: "shop_goto", arguments: { url: "/" } }];
    const screens = explored();
    const { outcome } = await cartography(
      [
        { body: toolCalls(MODEL, away) },
        { body: toolCalls(MODEL, home) },
        { body: toolCalls(MODEL, HOME_MAPPED) },
        { body: answer(MODEL, "Done.") },
        { body: toolCalls(MODEL, [submit(screens)]) },
        { body: answer(MODEL, "Done.") },
      ],
      { cards: ["shop-api", "shop-db", "order-specs"] },
    );
    assert.deepEqual(elsewhere.requested, []);
    assert.equal(outcome.index!.run.actions, 2);
    assert.match(messages(outcome), new RegExp(`shop_goto: ${elsewhere.origin}/ is not an address of shop`));
  });
});

/** The placement of the tables of the base that gives the card `cardSubmission` describes, and the call that confirms the table set aside. */
const BASE_ASIDE = { name: "public.schema_migrations", reason: "The log of the migrations." };
const BASE_PLACEMENTS = [
  {
    id: "c1",
    name: "place_elements",
    arguments: {
      domains: Object.keys(PLACED["shop-db"]!).map((id) => ({ id, label: id, description: `What shop-db holds of the ${id}.` })),
      items: [...Object.entries(PLACED["shop-db"]!).flatMap(([domain, names]) => names.map((name) => ({ name, domain, role: `About ${name}.` }))), BASE_ASIDE],
    },
  },
  { id: "c2", name: "place_elements", arguments: { items: [BASE_ASIDE] } },
];

/** Maps the base in a session of its own, in one batch, then consolidates the cards. */
const mappingTheBase = () => [
  ...BASE_PLACEMENTS.map((call) => ({ body: toolCalls(MODEL, [call]) })),
  { body: answer(MODEL, "Done.") },
  // The file of each of its two domains, then the consolidation.
  { body: answer(MODEL, "The tables `public.orders` and `public.order_lines`.") },
  { body: answer(MODEL, "The table `public.customers`.") },
  ...happy(),
];

describe("criterion 7 — the database tool only queries the catalog", () => {
  it("sends only catalog queries while the base is mapped, and offers no tool of the base", async () => {
    const { database, server, outcome } = await cartography(mappingTheBase(), { cards: ["shop-api", "order-specs", "shop"] });
    assert.equal(outcome.index!.status, "complete");
    assert.ok(database.queries.length >= 3);
    for (const query of database.queries) assert.match(query, /information_schema|pg_catalog/);
    assert.deepEqual(toolsOffered(server, 0), ["place_elements", "remember"]);
  });
});

describe("single read, criterion 1 — a full cartography sends each catalog query once", () => {
  it("reads the catalog of the base at the check only", async () => {
    const { database, outcome } = await cartography(mappingTheBase(), { cards: ["shop-api", "order-specs", "shop"] });
    assert.equal(outcome.index!.status, "complete");
    assert.ok(database.queries.length > 0);
    assert.equal(new Set(database.queries).size, database.queries.length);
  });
});

describe("criterion 8 — the connection string appears in neither the index, the journal, nor the model exchanges", () => {
  it("keeps the secret out of every trace, the base mapped in the run", async () => {
    const { outcome, root, server } = await cartography(mappingTheBase(), { cards: ["shop-api", "order-specs", "shop"] });
    assert.ok(outcome.index);
    for (const trace of [readFileSync(indexFile(root), "utf8"), JSON.stringify(outcome.journal), JSON.stringify(server.requests)]) {
      assert.ok(!trace.includes("s3cret-db-pass") && !trace.includes(DB_URL));
    }
  });
});

describe("criterion 9 — past 200 actions nothing more runs, and no complete index exists", () => {
  it("stops the task of the interface at the 201st action: the interface has no card, and the index is truncated", async () => {
    const actions = Array.from({ length: 201 }, (_, i) => ({ id: `g${i}`, name: "shop_goto", arguments: { url: "/" } }));
    const before = site.requested.length;
    const { outcome } = await cartography(
      [{ body: toolCalls(MODEL, actions) }, { body: toolCalls(MODEL, [submit(gathering("shop"))]) }, { body: answer(MODEL, "Done.") }],
      { cards: ["shop-api", "shop-db", "order-specs"] },
    );
    assert.match(messages(outcome), /The session that explores shop reached its actions limit\.[^]*No card was written: no element of shop was placed\./);
    // The run checks the interface, its cartographer checks it again, opens its page, then one request per action that ran.
    assert.equal(site.requested.slice(before).filter((r) => r === "GET /").length, 3 + 200);
    assert.equal(outcome.journal.filter((entry) => entry.message === "shop_goto: The task reached its actions limit; the call did not run.").length, 1);
    assert.deepEqual([outcome.index!.status, outcome.index!.sources.find((s) => s.id === "shop")!.state], ["truncated", "not_read"]);
  });

  it("marks truncated an index accepted before a limit stopped the consolidation, or made from a truncated card", async () => {
    const { outcome } = await cartography([{ body: toolCalls(MODEL, [submit(MERGES)]) }, { body: answer(MODEL, "Done.") }], {
      limits: { maxIterations: 1, maxMinutes: 10, maxActions: 200 },
    });
    assert.deepEqual([outcome.index!.status, outcome.index!.run.iterations], ["truncated", 1]);
    // An index was written: the cartography is not to be resumed.
    assert.equal(outcome.stoppedBy, undefined);
    const late = [
      { body: toolCalls(MODEL, [{ id: "g1", name: "shop_goto", arguments: { url: "/" } }]) },
      // The session is cut once the home is placed: the screen its link leads to is left unplaced, and the card truncated.
      { body: toolCalls(MODEL, [HOME_MAPPED[0]!]) },
    ];
    const screens = explored();
    const cut = await cartography([...late, { body: toolCalls(MODEL, [submit(screens)]) }, { body: answer(MODEL, "Done.") }], {
      cards: ["shop-api", "shop-db", "order-specs"],
      limits: { maxIterations: 2, maxMinutes: 10, maxActions: 200 },
    });
    assert.match(messages(cut.outcome), /The card was written to .*shop\.json, truncated\./);
    assert.deepEqual([cut.outcome.index!.status, cut.outcome.index!.sources.find((s) => s.id === "shop")!.state], ["truncated", "read"]);
  });
});

describe("criterion 10 — a declared document is listed, read when it has a card", () => {
  it("marks a document without a card as not read, refuses an index that refers to it, and truncates the index", async () => {
    const noCard = Array.from({ length: 4 }, () => ({ body: answer(MODEL, "Nothing to say.") }));
    const [orders, customers] = MERGES.domains;
    const refersToIt = { domains: [{ ...orders!, from: [...orders!.from, from("specs-1", "returns")] }, customers!] };
    const { outcome, server } = await cartography(
      [...noCard, { body: toolCalls(MODEL, [submit(refersToIt)]) }, { body: toolCalls(MODEL, [submit(MERGES, "x2")]) }, { body: answer(MODEL, "Done.") }],
      { documents: ["specs/orders.md", "specs/returns.md"] },
    );
    assert.match(JSON.stringify(server.requests[5]!.body), /specs-1 is no source with a card\. The sources: shop-api, shop-db, order-specs, shop\./);
    assert.deepEqual(
      outcome.index!.sources.filter((s) => s.type === "document").map((s) => [s.id, s.state, s.cardFingerprint !== undefined]),
      [
        ["order-specs", "read", true],
        ["specs-1", "not_read", false],
      ],
    );
    assert.equal(outcome.index!.status, "truncated");
    assert.match(JSON.stringify(server.requests[4]!.body), /## specs-1 \(document\): not mapped; leave it out\./);
  });
});

describe("criterion 11 — the run commits and pushes nothing", () => {
  it("leaves the index untracked, and HEAD and every reference, local or remote, as they were", async () => {
    const { root, before } = await cartography(happy());
    const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    assert.deepEqual(references(root), before);
    assert.match(git(root, "status", "--porcelain", "--untracked-files=all"), /^\?\? \.oqas\/index\/domain-index\.json$/m);
    assert.match(before.remote, /refs\/heads\/main/);
  });
});

describe("a session that fails", () => {
  it("still writes, truncated, an index accepted before the consolidation failed", async () => {
    const { outcome } = await cartography([{ body: toolCalls(MODEL, [submit(MERGES)]) }, { status: 500, body: { error: { message: "overloaded" } } }]);
    assert.equal(outcome.index!.status, "truncated");
    assert.match(messages(outcome), /The index was accepted\.\nThe consolidation failed: .*\nThe index was written to/);
  });

  it("journals the failure of the model, and writes nothing when no source has a card", async () => {
    const down = await closedPort();
    const consolidation = await cartography([], {}, new CatalogDouble(), `http://127.0.0.1:${down}/v1`);
    assert.equal(existsSync(indexFile(consolidation.root)), false);
    assert.match(messages(consolidation.outcome), /The consolidation failed: /);
    const cards = await cartography([], { cards: [] }, new CatalogDouble(), `http://127.0.0.1:${down}/v1`);
    assert.match(
      messages(cards.outcome),
      /No card was written: no element of shop-api was placed\.[^]*No card was written: no element of shop-db was placed\.[^]*The session that explores shop failed: [^]*No index was written: no source has a card\./,
    );
  });
});

/** The lines of the trace of a cartography, each read back from its file. */
const traceOf = (outcome: CartographyOutcome): TraceLine[] =>
  readFileSync(outcome.tracePath, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as TraceLine);
const PHASES = ["survey", "card", "consolidation", "index"];
/** Whether every phase started, for a source or for the whole run, has its end. */
const everyStartEnds = (lines: readonly TraceLine[]) => {
  const ends = (type: string) =>
    lines.filter((line) => line.actor === "harness" && line.event.type === type).map((line) => `${line.phase}:${line.source ?? ""}`);
  return JSON.stringify(ends("started").sort()) === JSON.stringify(ends("finished").sort());
};

describe("trace, criterion 1 — the trace holds the phases in order, and each tool call with its arguments and result", () => {
  it("writes survey, then card, then consolidation, then index lines, and every call of the agents", async () => {
    const { outcome } = await cartography(mappingTheBase(), { cards: ["shop-api", "order-specs", "shop"] });
    const lines = traceOf(outcome);
    const order = lines.map((line) => PHASES.indexOf(line.phase));
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
    );
    assert.deepEqual([...new Set(lines.map((line) => line.phase))], PHASES);
    for (const { id, name, arguments: args } of [...BASE_PLACEMENTS, submit(MERGES)]) {
      const call = lines.find((line) => line.actor === "agent" && line.event.type === "tool-call" && line.event.callId === id);
      assert.deepEqual(call?.event, { type: "tool-call", callId: id, tool: name, arguments: args }, name);
      const result = lines.find((line) => line.actor === "agent" && line.event.type === "tool-result" && line.event.callId === id);
      assert.ok(result?.event.type === "tool-result" && result.event.tool === name, name);
    }
    const asked = lines.find((line) => line.source === "shop-db" && line.event.type === "message");
    for (const table of TABLES) assert.match(JSON.stringify(asked?.event), new RegExp(`### public\\.${table}`));
    assert.ok(lines.filter((line) => line.phase === "card" && line.actor === "agent").every((line) => line.source === "shop-db"));
    const inventory = lines.find((line) => line.source === "shop-db" && line.event.type === "inventory");
    assert.ok(
      inventory?.event.type === "inventory" && inventory.event.items === TABLES.length && !inventory.event.truncated && inventory.event.fingerprint !== "",
    );
    assert.ok(lines.some((line) => line.phase === "consolidation" && line.event.type === "message" && line.event.text.includes("submit_index")));
    assert.ok(everyStartEnds(lines));
    assert.deepEqual(
      lines
        .filter((line) => line.event.type === "finished" && line.source === undefined)
        .map((line) => [line.phase, line.event.type === "finished" && line.event.outcome]),
      [
        ["survey", "done"],
        ["card", "done"],
        ["consolidation", "done"],
        ["index", "done"],
      ],
    );
  });
});

describe("trace, criterion 2 — a reasoning of the model is in the trace, in its place among the tool calls", () => {
  it("writes the reasoning of the agent of a card before the call it led to", async () => {
    const thinking = toolCalls(MODEL, [BASE_PLACEMENTS[0]!]) as { choices: { message: Record<string, unknown> }[] };
    thinking.choices[0]!.message.reasoning_content = "One domain is enough.";
    const { outcome } = await cartography([{ body: thinking }, ...mappingTheBase().slice(1)], { cards: ["shop-api", "order-specs", "shop"] });
    const agent = traceOf(outcome)
      .filter((line) => line.actor === "agent" && line.source === "shop-db")
      .map((line) => line.event);
    assert.deepEqual(agent.slice(0, 2), [
      { type: "reasoning", text: "One domain is enough." },
      { type: "tool-call", callId: "c1", tool: "place_elements", arguments: BASE_PLACEMENTS[0]!.arguments },
    ]);
  });
});

describe("trace, criterion 3 — a card kept because it is up to date leaves a harness line, and no line of an agent", () => {
  it("says the card was kept, for each source whose card is up to date", async () => {
    const { outcome } = await cartography(happy());
    const lines = traceOf(outcome);
    for (const source of ["shop-api", "shop-db", "order-specs", "shop"]) {
      const own = lines.filter((line) => line.source === source && line.phase === "card");
      assert.ok(
        own.every((line) => line.actor === "harness"),
        source,
      );
      assert.ok(
        own.some((line) => line.event.type === "journal" && line.event.message === `The card of ${source} is up to date; it was kept.`),
        source,
      );
      assert.deepEqual(own.at(-1)?.event, { type: "finished", outcome: "kept" }, source);
    }
  });
});

describe("trace, criterion 4 — no connection string is in the trace", () => {
  it("masks the connection string the agents write, and cuts a string too long, the base mapped in the run", async () => {
    const echo = [{ id: "c0", name: "place_elements", arguments: { items: [{ name: "public.orders", domain: "all", role: `Read from ${DB_URL}` }] } }];
    const replies = [
      { body: toolCalls(MODEL, echo) },
      ...mappingTheBase().slice(0, -2),
      { body: toolCalls(MODEL, [submit(MERGES)]) },
      { body: answer(MODEL, `Done with ${DB_URL}. ${"z".repeat(MAX_TRACED_LENGTH + 1)}`) },
    ];
    const { outcome } = await cartography(replies, { cards: ["shop-api", "order-specs", "shop"] });
    const trace = readFileSync(outcome.tracePath, "utf8");
    assert.ok(trace.includes("[secret]") && !trace.includes(DB_URL) && !trace.includes("s3cret-db-pass"));
    assert.match(trace, /"Done with \[secret\]\. z+\[… 21 characters cut\]"/);
  });
});

describe("trace, criterion 5 — a cartography stopped by a limit leaves a trace readable up to the stop", () => {
  it("ends every phase it started, the task of the interface stopped at its limit", async () => {
    const actions = Array.from({ length: 201 }, (_, i) => ({ id: `g${i}`, name: "shop_goto", arguments: { url: "/" } }));
    const { outcome } = await cartography(
      [{ body: toolCalls(MODEL, actions) }, { body: toolCalls(MODEL, [submit(gathering("shop"))]) }, { body: answer(MODEL, "Done.") }],
      { cards: ["shop-api", "shop-db", "order-specs"] },
    );
    const lines = traceOf(outcome);
    assert.ok(lines.some((line) => line.source === "shop" && line.actor === "agent" && line.event.type === "stopped"));
    assert.deepEqual(lines.filter((line) => line.source === "shop").at(-1)?.event, { type: "finished", outcome: "failed" });
    assert.ok(everyStartEnds(lines));
  });
});

describe("trace, criterion 6 — an observer gets each line as it is written, and every phase started ends", () => {
  it("knows a phase has started before it is over, and gets the lines of the file in their order", async () => {
    const seen: TraceLine[] = [];
    let root = "";
    let indexBeforeConsolidation: boolean | undefined;
    const observe = (line: TraceLine) => {
      seen.push(line);
      if (line.phase === "consolidation" && line.event.type === "started") indexBeforeConsolidation = existsSync(indexFile(root));
    };
    const run = await cartography(mappingTheBase(), {
      cards: ["shop-api", "order-specs", "shop"],
      observe,
      prepare: (made) => (root = made),
    });
    assert.deepEqual(seen, traceOf(run.outcome));
    const started = seen.findIndex((line) => line.source === "shop-db" && line.event.type === "started");
    const firstCall = seen.findIndex((line) => line.source === "shop-db" && line.event.type === "tool-call");
    assert.ok(started >= 0 && started < firstCall);
    assert.equal(indexBeforeConsolidation, false);
  });

  it("ends as failed the phases a source that does not answer stops, and those a run that throws leaves open", async () => {
    const down = await closedPort();
    const silent = await cartography([], { uiUrl: `http://127.0.0.1:${down}`, cards: [] });
    const survey = traceOf(silent.outcome);
    assert.ok(survey.some((line) => line.source === "shop" && line.event.type === "survey" && !line.event.answers && line.event.error !== undefined));
    assert.deepEqual(survey.at(-1)?.event, { type: "finished", outcome: "failed" });
    assert.ok(everyStartEnds(survey) && survey.every((line) => line.phase === "survey"));
    const observed: TraceLine[] = [];
    const blocked = cartography(mappingTheBase(), {
      cards: ["shop-api", "order-specs", "shop"],
      observe: (line) => observed.push(line),
      prepare: (root) => mkdirSync(join(root, ".oqas", "index", "sources", "shop-db.json")),
    });
    await assert.rejects(blocked);
    assert.ok(everyStartEnds(observed));
    const ends = observed
      .filter((line) => line.event.type === "finished")
      .map((line) => [line.phase, line.source ?? "", line.event.type === "finished" && line.event.outcome]);
    assert.ok(ends.some(([phase, source, outcome]) => phase === "card" && source === "shop-db" && outcome === "failed"));
    assert.deepEqual(ends.at(-1), ["card", "", "failed"]);
  });
});

describe("faster cartography", () => {
  const sources = (ids: readonly string[]) => (root: string) =>
    ids.map((id) => ({
      id,
      type: id === "shop" ? "web" : id === "shop-db" ? "postgresql" : id === "shop-api" ? "openapi" : "document",
      state: "read",
      cardFingerprint: cardPrint(root, id),
    }));
  const ALL = ["shop-api", "shop-db", "order-specs", "shop"];
  /** An index of the cards of the repository, as a run made it before. */
  const index = (root: string, changes: object = {}, ids: readonly string[] = ALL) => ({
    formatVersion: 1,
    producedAt: "2026-11-12T08:00:00.000Z",
    environment: "local",
    model: { provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: MODEL },
    run: { iterations: 9, actions: 0, durationMs: 1 },
    status: "complete",
    sources: sources(ids)(root),
    ...SUBMISSION,
    ...changes,
  });
  const written =
    (content: (root: string) => unknown) =>
    (root: string): void => {
      const value = content(root);
      writeFileSync(indexFile(root), typeof value === "string" ? value : JSON.stringify(value));
    };
  const usages = (lines: readonly TraceLine[]) =>
    lines.flatMap((line) =>
      line.event.type === "usage" ? [[line.phase, line.source ?? "", line.event.requests, line.event.inputTokens, line.event.outputTokens]] : [],
    );

  describe("faster cartography, criterion 1 — up-to-date cards and an index made of them send no request and keep the index", () => {
    it("keeps the index without any request to the model, and the trace says why", async () => {
      const { outcome, root, server } = await cartography([], { prepare: written((made) => index(made)) });
      assert.equal(server.requests.length, 0);
      assert.deepEqual([outcome.indexPath, outcome.index!.producedAt], [indexFile(root), "2026-11-12T08:00:00.000Z"]);
      const lines = traceOf(outcome);
      const why = lines.find((line) => line.phase === "index" && line.event.type === "journal");
      assert.match(
        why?.event.type === "journal" ? why.event.message : "",
        /^The index .*domain-index\.json is complete and made of the cards every source has now, by their fingerprints; it was kept\.$/,
      );
      const phases = lines.filter((line) => line.source === undefined && (line.event.type === "started" || line.event.type === "finished"));
      assert.deepEqual(
        phases.slice(-2).map((line) => [line.phase, line.event]),
        [
          ["index", { type: "started" }],
          ["index", { type: "finished", outcome: "kept" }],
        ],
      );
      assert.ok(!lines.some((line) => line.phase === "consolidation" || line.actor === "agent"));
      assert.ok(usages(lines).every(([, , requests, input]) => requests === 0 && input === undefined));
    });

    it("makes the index again when it is truncated, of another environment, unreadable, recorded no fingerprint, or force is set", async () => {
      const stale: readonly [(root: string) => unknown, string][] = [
        [
          (root) => ({ ...index(root), status: "truncated", sources: [...sources(ALL.slice(0, 3))(root), { id: "shop", type: "web", state: "not_read" }] }),
          "the index at hand is truncated",
        ],
        [(root) => index(root, { environment: "staging" }), "the index at hand is of the environment staging"],
        [() => "{ not json", "no index could be read"],
        [
          (root) => index(root, { sources: sources(ALL)(root).map(({ cardFingerprint: _, ...source }) => source) }),
          "the index at hand records no fingerprint of the card of shop-api, as an earlier version made it",
        ],
      ];
      for (const [content, reason] of stale) {
        const { outcome, server } = await cartography(happy(), { prepare: written(content) });
        assert.ok(server.requests.length > 0, reason);
        assert.equal(outcome.index!.producedAt, "2026-11-13T10:00:00.000Z", reason);
        assert.ok(messages(outcome).includes(`The index is made: ${reason}.`), messages(outcome));
      }
      const silent = Array.from({ length: 16 }, () => ({ body: answer(MODEL, "Nothing to say.") }));
      const forced = await cartography(silent, { force: true, prepare: written((made) => index(made)) });
      assert.ok(forced.server.requests.length > 0);
      assert.match(messages(forced.outcome), /The index is made: force is set\./);
    });
  });

  describe("faster cartography, criterion 2 — a card made again, added or removed makes the consolidation again, with the new fingerprints", () => {
    it("consolidates again when a card was made again, and records its new fingerprint", async () => {
      let before = "";
      // The document changed: the agent that maps it reads it again and hands its domain in, then the index is consolidated.
      const orders = {
        id: "orders",
        label: "orders",
        description: "What order-specs holds of the orders.",
        elements: [{ file: "orders.md", role: "About the orders." }],
        body: "`orders.md` tells how an order is placed.",
      };
      const remade = [
        { body: toolCalls(MODEL, [{ id: "r1", name: "order_specs_read_file", arguments: {} }]) },
        { body: toolCalls(MODEL, [{ id: "w1", name: "write_domain", arguments: orders }]) },
        { body: answer(MODEL, "Done.") },
        ...happy(),
      ];
      const prepare = (root: string) => {
        written(index)(root);
        before = cardPrint(root, "order-specs");
        writeFileSync(join(root, "specs", "orders.md"), "# Orders\n\n## Placing an order\n\nA customer places an order, then pays it.\n");
      };
      const { outcome, root, server } = await cartography(remade, { prepare });
      assert.equal(server.requests.length, 5);
      assert.match(messages(outcome), /The index is made: the card of order-specs is not the one the index at hand was made of\./);
      const recorded = outcome.index!.sources.find((source) => source.id === "order-specs")!.cardFingerprint;
      assert.ok(recorded === cardPrint(root, "order-specs") && recorded !== before);
      assert.deepEqual(
        outcome.index!.sources.map((source) => source.cardFingerprint),
        ALL.map((id) => cardPrint(root, id)),
      );
    });

    it("consolidates again when a source was added or removed, and records the fingerprints of the cards of the run", async () => {
      const added = await cartography(happy(), { prepare: written((root) => index(root, without("shop"), ALL.slice(0, 3))) });
      assert.match(messages(added.outcome), /The index is made: shop is not a source of the index at hand\./);
      assert.deepEqual(
        added.outcome.index!.sources.map((source) => [source.id, source.cardFingerprint]),
        ALL.map((id) => [id, cardPrint(added.root, id)]),
      );
      const gone = { id: "old-specs", type: "document", state: "read", cardFingerprint: `sha256:${"0".repeat(64)}` };
      const removed = await cartography(happy(), { prepare: written((root) => index(root, { sources: [...sources(ALL)(root), gone] })) });
      assert.match(messages(removed.outcome), /The index is made: old-specs is no longer a source of the run\./);
      assert.deepEqual(
        removed.outcome.index!.sources.map((source) => [source.id, source.cardFingerprint]),
        ALL.map((id) => [id, cardPrint(removed.root, id)]),
      );
    });
  });

  describe("faster cartography, criterion 3 — the trace gives the requests to the model of each phase and of each source", () => {
    it("counts the requests and the tokens of each phase and of each card, on scripted answers", async () => {
      const { outcome, server } = await cartography(mappingTheBase(), { cards: ["shop-api", "order-specs", "shop"] });
      // The base has two domains: two batches of calls to place its tables, then the file of each domain, then the consolidation.
      assert.equal(server.requests.length, 7);
      assert.deepEqual(usages(traceOf(outcome)), [
        ["survey", "", 0, undefined, undefined],
        ["card", "shop-api", 0, undefined, undefined],
        ["card", "shop-db", 5, 5, 5],
        ["card", "order-specs", 0, undefined, undefined],
        ["card", "shop", 0, undefined, undefined],
        ["card", "", 5, 5, 5],
        ["consolidation", "", 2, 2, 2],
        ["index", "", 0, undefined, undefined],
      ]);
      const ends = traceOf(outcome).flatMap((line, i, lines) => (line.event.type === "finished" ? [lines[i - 1]!.event.type] : []));
      assert.ok(
        ends.every((type) => type === "usage"),
        "each phase gives its usage just before its end",
      );
    });
  });
});
