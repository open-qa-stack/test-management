import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { CopilotAgentRuntime, ModelGateway } from "@open-qa-stack/harness";
import { validateConfig, validateDomainIndex, type DomainIndexSubmission, type MappedKnowledge, type ResolvedConfig, type SourceCard, type SourceCardSubmission } from "@open-qa-stack/shared";
import { answer, closedPort, scriptedServer, testSite, toolCalls, type ScriptedServer, type TestSite } from "@open-qa-stack/testing";
import { fingerprintOf, knowledgeInventory, type SqlClient } from "@open-qa-stack/tools";
import { Cartographer, INDEX_FILE_NAME, type CartographyOutcome } from "../src/index.ts";

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
    if (text.includes("pg_constraint")) return { columns: [], rows: [] };
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
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe", encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" } });
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
  readonly limits?: { maxIterations: number; maxDurationMinutes: number; maxActions: number };
  readonly documents?: readonly string[];
  readonly contractUrl?: string;
  readonly environment?: string;
  /** Reaches the base with the PostgreSQL client rather than the catalog double. */
  readonly realDatabase?: boolean;
  /** Runs at the autonomous level, with the system clock. */
  readonly autonomous?: boolean;
  /** Sources whose up-to-date card is in the repository before the run; all four by default. */
  readonly cards?: readonly string[];
}

function configFor(modelUrl: string, setup: Setup = {}): ResolvedConfig {
  const attachments = [{ application: "shop" }];
  const knowledge = [
    setup.contractUrl === undefined ? { id: "shop-api", type: "openapi", path: "contracts/shop.json", attachments } : { id: "shop-api", type: "openapi", url: setup.contractUrl, attachments },
    { id: "shop-db", type: "postgresql", connectionStringEnv: "SHOP_DB_URL", attachments },
    ...(setup.documents ?? ["specs/orders.md"]).map((path, i) => ({ id: i === 0 ? "order-specs" : `specs-${i}`, type: "document", path, attachments: i === 0 ? [{ application: "shop", environment: "local" }] : attachments })),
    { id: "staging-specs", type: "document", path: "specs/returns.md", attachments: [{ application: "shop", environment: "staging" }] },
  ];
  const text = JSON.stringify({
    formatVersion: 1,
    applications: [
      { id: "shop", name: "Shop", type: "web", authentication: { method: "none" }, environments: [{ name: "local", uiUrl: setup.uiUrl ?? site.origin }, { name: "staging", uiUrl: site.origin }] },
      { id: "ledger", name: "Ledger", type: "api", authentication: { method: "none" }, environments: [{ name: "local", apis: [{ name: "api", baseUrl: site.origin }] }] },
    ],
    knowledge,
    model: { mode: "provider-key", provider: "openai", baseUrl: modelUrl, model: MODEL },
    autonomy: setup.autonomous === true ? { level: "autonomous" } : { level: "custom", task: setup.limits ?? { maxIterations: 20, maxDurationMinutes: 10, maxActions: 200 }, batch: { maxTests: 1, maxIdleRounds: 1 }, guardrailMinutes: 1 },
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

/** A card that puts every element of a source in one domain. */
function cardSubmission(id: string, elements: readonly string[] = ELEMENTS[id]!): SourceCardSubmission {
  const technical = (name: string) => name.endsWith("schema_migrations");
  return { domains: [{ id: "all", label: "All", description: `Everything ${id} holds.`, items: elements.filter((name) => !technical(name)).map((name) => ({ name, summary: `About ${name}.` })) }], unassigned: elements.filter(technical) };
}

/** Writes in the repository an up-to-date card of each source named. */
async function writeCards(root: string, config: ResolvedConfig, database: SqlClient, ids: readonly string[]): Promise<void> {
  mkdirSync(join(root, ".oqas", "index", "sources"), { recursive: true });
  for (const id of ids) {
    const knowledge = config.knowledge.find((source): source is MappedKnowledge => source.id === id && source.type !== "logs");
    const fingerprint = knowledge === undefined ? fingerprintOf(config.applications[0]!.environments[0]!.uiUrl!) : (await knowledgeInventory(knowledge, { repositoryRoot: root, env: { SHOP_DB_URL: DB_URL }, sqlClient: () => database })).fingerprint;
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
    { id: "customers", label: "Customers", description: "The customers of the shop.", references: [{ source: "shop-api", items: ["customers"] }, { source: "shop-db", items: ["public.customers"] }] },
  ],
  unassigned: [
    { source: "shop-api", items: ["/health"] },
    { source: "shop-db", items: ["public.schema_migrations"] },
    { source: "shop", items: ["/"] },
  ],
};

/** The submission without any reference to the sources named. */
function without(...sources: string[]): DomainIndexSubmission {
  const kept = (references: DomainIndexSubmission["unassigned"]) => references.filter((r) => !sources.includes(r.source));
  return { domains: SUBMISSION.domains.map((domain) => ({ ...domain, references: kept(domain.references) })), unassigned: kept(SUBMISSION.unassigned) };
}

const submit = (submission: unknown, id = "x1") => ({ id, name: "submit_index", arguments: submission });
const submitCard = (card: unknown, id = "k1") => ({ id, name: "submit_card", arguments: card });

interface Run {
  readonly before: ReturnType<typeof references>;
  readonly outcome: CartographyOutcome;
  readonly server: ScriptedServer;
  readonly root: string;
  readonly database: CatalogDouble;
}

/** Runs a cartography against a scripted model, the cards of `setup.cards` already made, then stops the model server. */
async function cartography(replies: readonly { status?: number; body: unknown }[], setup: Setup = {}, database = new CatalogDouble(), modelUrl?: string): Promise<Run> {
  const server = await scriptedServer(replies);
  const gateway = await ModelGateway.start({ kind: "live", upstream: { baseUrl: modelUrl ?? server.baseUrl } });
  const home = mkdtempSync(join(workspace, "home-"));
  const runtime = new CopilotAgentRuntime({ endpoint: gateway, model: MODEL, homeDirectory: home });
  const root = repository();
  const before = references(root);
  try {
    const config = configFor(server.baseUrl, setup);
    await writeCards(root, config, database, setup.cards ?? Object.keys(ELEMENTS));
    const cartographer = new Cartographer({
      config,
      environment: setup.environment ?? "local",
      repositoryRoot: root,
      env: { SHOP_DB_URL: DB_URL },
      runtime,
      browser: { actionTimeoutMs: 1000, navigationTimeoutMs: 3000 },
      ...(setup.realDatabase === true ? {} : { sqlClient: () => database }),
      ...(setup.autonomous === true ? {} : { now: () => new Date("2026-11-13T10:00:00.000Z") }),
    });
    return { outcome: await cartographer.run(), server, root, database, before };
  } finally {
    await runtime.close();
    await gateway.close();
    await server.close();
  }
}

const happy = () => [{ body: toolCalls(MODEL, [submit(SUBMISSION)]) }, { body: answer(MODEL, "Two domains: orders and customers.") }];
const messages = (outcome: CartographyOutcome) => outcome.journal.map((entry) => entry.message).join("\n");
const indexFile = (root: string) => join(root, ".oqas", "index", INDEX_FILE_NAME);
const toolsOffered = (server: ScriptedServer, request: number) => (server.requests[request]!.body as { tools: { function: { name: string } }[] }).tools.map((tool) => tool.function.name);

describe("criterion 1 — the cartographer writes an index that passes the schema of the index format", () => {
  it("consolidates the cards of a contract, a base, a document and an interface, with the notes but no tool of the sources", async () => {
    const { outcome, root, server } = await cartography(happy());
    assert.equal(outcome.indexPath, indexFile(root));
    const written = JSON.parse(readFileSync(indexFile(root), "utf8")) as unknown;
    assert.deepEqual(validateDomainIndex(written), { ok: true, value: outcome.index });
    assert.deepEqual(outcome.index!.sources, [
      { id: "shop-api", type: "openapi", state: "read" },
      { id: "shop-db", type: "postgresql", state: "read" },
      { id: "order-specs", type: "document", state: "read" },
      { id: "shop", type: "web", state: "read" },
    ]);
    assert.deepEqual([outcome.index!.status, outcome.index!.producedAt, outcome.index!.environment, outcome.index!.run.iterations], ["complete", "2026-11-13T10:00:00.000Z", "local", 2]);
    assert.deepEqual(toolsOffered(server, 0).sort(), ["recall", "remember", "submit_index"]);
    assert.match(messages(outcome), /The card of shop is up to date; it was kept\.\nThe index was accepted\.\nThe index was written to .*domain-index\.json, complete\./);
  });
});

describe("criterion 2 — every element of every card is in a domain or unassigned", () => {
  it("tells the agent the cards, element by element, and places them all", async () => {
    const { outcome, server } = await cartography(happy());
    const request = JSON.stringify(server.requests[0]!.body);
    for (const fragment of ["## shop-db (postgresql)", "- All (all): Everything shop-db holds.", "  - public.order_lines: About public.order_lines.", "- Unassigned: public.schema_migrations", "## shop (web)", "  - /orders: About /orders."]) {
      assert.ok(request.includes(JSON.stringify(fragment).slice(1, -1)), fragment);
    }
    const placed = [...outcome.index!.domains.flatMap((d) => d.references), ...outcome.index!.unassigned].flatMap((r) => r.items);
    for (const item of Object.values(ELEMENTS).flat()) assert.ok(placed.includes(item), item);
  });
});

describe("criterion 3 — an index that omits a table is not written, and the journal names the table", () => {
  it("refuses the submission, tells the agent why, and writes nothing", async () => {
    const forgetful = { ...SUBMISSION, unassigned: SUBMISSION.unassigned.filter((r) => r.source !== "shop-db") };
    const { outcome, root, server } = await cartography([{ body: toolCalls(MODEL, [submit(forgetful)]) }, { body: answer(MODEL, "Done.") }]);
    assert.equal(existsSync(indexFile(root)), false);
    assert.match(messages(outcome), /The index was refused: public\.schema_migrations of shop-db is in no domain nor in unassigned\./);
    assert.match(JSON.stringify(server.requests[1]!.body), /Fix it and submit it again/);
    assert.match(messages(outcome), /No index was written: no index was accepted before the session ended\./);
  });

  it("tells at most thirty errors at once, then every item still to place, by source", async () => {
    const invented = { ...SUBMISSION, unassigned: [...SUBMISSION.unassigned.filter((r) => r.source !== "shop-db"), { source: "shop-db", items: Array.from({ length: 31 }, (_, i) => `public.x${i}`) }] };
    const refused = await cartography([{ body: toolCalls(MODEL, [submit(invented)]) }, { body: answer(MODEL, "Done.") }]);
    const told = JSON.stringify(refused.server.requests[1]!.body);
    for (const fragment of ["- and 1 more", "Still to place, in a domain or in unassigned, each exactly as written:", "- shop-db: ", "public.schema_migrations"]) assert.ok(told.includes(fragment), fragment);
    const twice = await cartography([{ body: toolCalls(MODEL, [submit(SUBMISSION, "a"), submit(SUBMISSION, "b")]) }, { body: answer(MODEL, "Done.") }]);
    assert.match(JSON.stringify(twice.server.requests[1]!.body), /The index was already accepted/);
    assert.equal(twice.outcome.index!.status, "complete");
  });
});

describe("guiding a model that stumbles", () => {
  it("reads an item written after the name of its source, and reminds an agent that stops without an accepted index", async () => {
    const prefixed = { ...SUBMISSION, unassigned: [{ source: "shop-api", items: ["shop-api//health"] }, { source: "shop-db", items: ["shop-db:public.schema_migrations"] }, { source: "shop", items: ["/"] }] };
    const { outcome, server } = await cartography([
      { body: toolCalls(MODEL, [{ id: "g1", name: "shop_goto", arguments: { url: "/" } }]) },
      { body: answer(MODEL, "I will now look at the cards.") },
      { body: toolCalls(MODEL, [submit(prefixed)]) },
      { body: answer(MODEL, "Two domains.") },
    ]);
    assert.match(messages(outcome), /shop_goto: /);
    assert.match(JSON.stringify(server.requests[2]!.body), /You have not handed in an accepted index yet\. Call submit_index now\./);
    assert.deepEqual(outcome.index!.unassigned, SUBMISSION.unassigned);
    assert.match(messages(outcome), /The agent stopped without an accepted index; it was reminded to hand one in\.\nThe index was accepted\./);
  });

  it("stops reminding after three times, with the latest refusal each time", async () => {
    const { outcome, server } = await cartography([{ body: toolCalls(MODEL, [submit({ ...SUBMISSION, unassigned: [] })]) }, ...Array.from({ length: 4 }, () => ({ body: answer(MODEL, "Done.") }))]);
    assert.equal(server.requests.length, 5);
    assert.match(JSON.stringify(server.requests[4]!.body), /Still to place/);
    assert.equal(outcome.journal.filter((e) => e.message.startsWith("The agent stopped without an accepted index")).length, 3);
    assert.match(messages(outcome), /No index was written: no index was accepted before the session ended\./);
  });
});

describe("criterion 4 — an index that breaks the schema is not written, and the journal names the field", () => {
  it("journals the field of a submission that breaks the schema, a missing, an empty or an extra one", async () => {
    const { description: _, ...undescribed } = SUBMISSION.domains[1]!;
    const wrong = { domains: [{ ...SUBMISSION.domains[0]!, label: "", confidence: 0.9 }, undescribed] };
    const { outcome, root, server } = await cartography([{ body: toolCalls(MODEL, [submit(wrong)]) }, { body: answer(MODEL, "Done.") }]);
    assert.equal(existsSync(indexFile(root)), false);
    const text = messages(outcome);
    assert.match(text, /The index was refused: \/domains\/1 must have required property 'description'\./);
    assert.match(text, /The index was refused: \/domains\/0\/label must NOT have fewer than 1 characters\./);
    assert.match(text, /The index was refused: \/domains\/0\/confidence is not allowed\./);
    assert.match(JSON.stringify(server.requests[1]!.body), /confidence is not allowed/);
  });

  it("refuses a repeated domain, and journals the field of a whole index that breaks the schema", async () => {
    const repeated = { ...SUBMISSION, domains: [...SUBMISSION.domains, SUBMISSION.domains[1]!] };
    const twice = await cartography([{ body: toolCalls(MODEL, [submit(repeated)]) }, { body: answer(MODEL, "Done.") }]);
    assert.match(messages(twice.outcome), /The index was refused: \/domains\/2\/id repeats the domain customers\./);
    const { outcome, root } = await cartography([{ body: toolCalls(MODEL, [submit(without("shop", "order-specs"))]) }, { body: answer(MODEL, "Done.") }], { environment: "" });
    assert.equal(existsSync(indexFile(root)), false);
    assert.match(messages(outcome), /The index does not match its schema: \/environment must NOT have fewer than 1 characters\.\nNo index was written\./);
  });
});

describe("criterion 5 — a declared source that does not answer stops the run before any exploration", () => {
  it("names each source in error and its cause, starts no session, writes nothing", async () => {
    const down = await closedPort();
    const failing: SqlClient = { query: () => Promise.reject("refused") };
    const { outcome, root, server } = await cartography([], { uiUrl: `http://127.0.0.1:${down}`, documents: ["specs/missing.md"], cards: [] }, failing as unknown as CatalogDouble);
    assert.deepEqual(server.requests, []);
    assert.equal(existsSync(indexFile(root)), false);
    const errors = outcome.journal.filter((entry) => entry.source !== undefined).map((entry) => [entry.source, entry.message]);
    assert.deepEqual(errors.map(([source]) => source), ["shop-db", "order-specs", "shop"]);
    assert.match(errors[0]![1]!, /^The source shop-db does not answer: refused$/);
    assert.match(errors[1]![1]!, /^The source order-specs does not answer: ENOENT/);
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
    const screens = { ...SUBMISSION, domains: SUBMISSION.domains.map((d) => ({ ...d, references: d.references.filter((r) => r.source !== "shop") })) };
    const { outcome } = await cartography(
      [{ body: toolCalls(MODEL, away) }, { body: toolCalls(MODEL, home) }, { body: toolCalls(MODEL, [submitCard(cardSubmission("shop", ["/"]))]) }, { body: answer(MODEL, "Done.") }, { body: toolCalls(MODEL, [submit(screens)]) }, { body: answer(MODEL, "Done.") }],
      { cards: ["shop-api", "shop-db", "order-specs"] },
    );
    assert.deepEqual(elsewhere.requested, []);
    assert.equal(outcome.index!.run.actions, 2);
    assert.match(messages(outcome), new RegExp(`shop_goto: ${elsewhere.origin}/ is not an address of shop`));
  });
});

/** Maps the base in a session of its own, which calls the tools named, then consolidates the cards. */
const mappingTheBase = (calls: readonly { id: string; name: string; arguments: unknown }[]) => [
  { body: toolCalls(MODEL, calls) },
  { body: toolCalls(MODEL, [submitCard(cardSubmission("shop-db"))]) },
  { body: answer(MODEL, "Done.") },
  ...happy(),
];

describe("criterion 7 — the database tool only queries the catalog", () => {
  it("sends only catalog queries while the base is mapped, and offers no tool that reads rows", async () => {
    const tables = [{ id: "c1", name: "shop_db_list_tables", arguments: {} }, { id: "c2", name: "shop_db_describe_table", arguments: { schema: "public", table: "orders" } }];
    const { database, server, outcome } = await cartography(mappingTheBase(tables), { cards: ["shop-api", "order-specs", "shop"] });
    assert.equal(outcome.index!.status, "complete");
    assert.ok(database.queries.length >= 3);
    for (const query of database.queries) assert.match(query, /information_schema|pg_catalog/);
    assert.ok(toolsOffered(server, 0).includes("shop_db_describe_table") && !toolsOffered(server, 0).some((name) => /shop_db_(sample_rows|search|query)$/.test(name)));
  });
});

describe("single read, criterion 1 — a full cartography sends each catalog query once", () => {
  it("reads the catalog of the base at the check only, when its agent calls no tool", async () => {
    const replies = [{ body: toolCalls(MODEL, [submitCard(cardSubmission("shop-db"))]) }, { body: answer(MODEL, "Done.") }, ...happy()];
    const { database, outcome } = await cartography(replies, { cards: ["shop-api", "order-specs", "shop"] });
    assert.equal(outcome.index!.status, "complete");
    assert.ok(database.queries.length > 0);
    assert.equal(new Set(database.queries).size, database.queries.length);
  });
});

describe("criterion 8 — the connection string appears in neither the index, the journal, nor the model exchanges", () => {
  it("keeps the secret out of every trace, the base mapped in the run", async () => {
    const { outcome, root, server } = await cartography(mappingTheBase([{ id: "c1", name: "shop_db_list_tables", arguments: {} }]), { cards: ["shop-api", "order-specs", "shop"] });
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
    const { outcome } = await cartography([{ body: toolCalls(MODEL, actions) }, { body: toolCalls(MODEL, [submit(without("shop"))]) }, { body: answer(MODEL, "Done.") }], { cards: ["shop-api", "shop-db", "order-specs"] });
    assert.match(messages(outcome), /The task reached its actions limit\.\nNo card was written/);
    // The run checks the interface, its cartographer checks it again, opens its page, then one request per action that ran.
    assert.equal(site.requested.slice(before).filter((r) => r === "GET /").length, 3 + 200);
    assert.equal(outcome.journal.filter((entry) => entry.message === "shop_goto: The task reached its actions limit; the call did not run.").length, 1);
    assert.deepEqual([outcome.index!.status, outcome.index!.sources.find((s) => s.id === "shop")!.state], ["truncated", "not_read"]);
  });

  it("marks truncated an index accepted before a limit stopped the consolidation, or made from a truncated card", async () => {
    const { outcome } = await cartography(happy(), { limits: { maxIterations: 1, maxDurationMinutes: 10, maxActions: 200 } });
    assert.deepEqual([outcome.index!.status, outcome.index!.run.iterations], ["truncated", 1]);
    const late = [{ body: toolCalls(MODEL, [{ id: "g1", name: "shop_goto", arguments: { url: "/" } }]) }, { body: toolCalls(MODEL, [submitCard(cardSubmission("shop", ["/"]))]) }];
    const screens = { ...SUBMISSION, domains: SUBMISSION.domains.map((d) => ({ ...d, references: d.references.filter((r) => r.source !== "shop") })) };
    const cut = await cartography([...late, { body: toolCalls(MODEL, [submit(screens)]) }, { body: answer(MODEL, "Done.") }], { cards: ["shop-api", "shop-db", "order-specs"], limits: { maxIterations: 2, maxDurationMinutes: 10, maxActions: 200 } });
    assert.match(messages(cut.outcome), /The card was written to .*shop\.json, truncated\./);
    assert.deepEqual([cut.outcome.index!.status, cut.outcome.index!.sources.find((s) => s.id === "shop")!.state], ["truncated", "read"]);
  });
});

describe("criterion 10 — a declared document is listed, read when it has a card", () => {
  it("marks a document without a card as not read, refuses an index that refers to it, and truncates the index", async () => {
    const noCard = Array.from({ length: 4 }, () => ({ body: answer(MODEL, "Nothing to say.") }));
    const refersToIt = { ...SUBMISSION, unassigned: [...SUBMISSION.unassigned, { source: "specs-1", items: ["Returns"] }] };
    const { outcome, server } = await cartography([...noCard, { body: toolCalls(MODEL, [submit(refersToIt)]) }, { body: toolCalls(MODEL, [submit(SUBMISSION, "x2")]) }, { body: answer(MODEL, "Done.") }], { documents: ["specs/orders.md", "specs/returns.md"] });
    assert.match(JSON.stringify(server.requests[5]!.body), /refers to specs-1, which has no card; leave it out/);
    assert.deepEqual(outcome.index!.sources.filter((s) => s.type === "document"), [
      { id: "order-specs", type: "document", state: "read" },
      { id: "specs-1", type: "document", state: "not_read" },
    ]);
    assert.equal(outcome.index!.status, "truncated");
    assert.match(JSON.stringify(server.requests[4]!.body), /## specs-1 \(document\): no card; leave it out\./);
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
    const { outcome } = await cartography([{ body: toolCalls(MODEL, [submit(SUBMISSION)]) }, { status: 500, body: { error: { message: "overloaded" } } }]);
    assert.equal(outcome.index!.status, "truncated");
    assert.match(messages(outcome), /The index was accepted\.\nThe consolidation failed: .*\nThe index was written to/);
  });

  it("journals the failure of the model, and writes nothing when no source has a card", async () => {
    const down = await closedPort();
    const consolidation = await cartography([], {}, new CatalogDouble(), `http://127.0.0.1:${down}/v1`);
    assert.equal(existsSync(indexFile(consolidation.root)), false);
    assert.match(messages(consolidation.outcome), /The consolidation failed: /);
    const cards = await cartography([], { cards: [] }, new CatalogDouble(), `http://127.0.0.1:${down}/v1`);
    assert.match(messages(cards.outcome), /The session failed: [^]*No index was written: no source has a card\./);
  });
});
