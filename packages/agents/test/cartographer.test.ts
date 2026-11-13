import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { CopilotAgentRuntime, ModelGateway } from "@open-qa-stack/harness";
import { validateConfig, validateDomainIndex, type DomainIndexSubmission, type ResolvedConfig } from "@open-qa-stack/shared";
import { answer, closedPort, scriptedServer, testSite, toolCalls, type ScriptedServer, type TestSite } from "@open-qa-stack/testing";
import type { SqlClient } from "@open-qa-stack/tools";
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
        { source: "order-specs", items: ["Placing an order"] },
      ],
    },
    { id: "customers", label: "Customers", description: "The customers of the shop.", references: [{ source: "shop-api", items: ["customers"] }, { source: "shop-db", items: ["public.customers"] }] },
  ],
  unassigned: [
    { source: "shop-api", items: ["/health"] },
    { source: "shop-db", items: ["public.schema_migrations"] },
  ],
};

const explore = [{ id: "s1", name: "shop_snapshot", arguments: {} }, { id: "d1", name: "order_specs_read_section", arguments: { number: 2 } }];
/** A submission that refers only to the contract and the base, which the harness reads itself. */
const INVENTORIED: DomainIndexSubmission = {
  ...SUBMISSION,
  domains: SUBMISSION.domains.map((domain) => ({ ...domain, references: domain.references.filter((r) => r.source === "shop-api" || r.source === "shop-db") })),
};
const submit = (submission: unknown, id = "x1") => ({ id, name: "submit_index", arguments: submission });

interface Run {
  readonly before: ReturnType<typeof references>;
  readonly outcome: CartographyOutcome;
  readonly server: ScriptedServer;
  readonly root: string;
  readonly database: CatalogDouble;
}

/** Runs a cartography against a scripted model, then stops the model server. */
async function cartography(replies: readonly { status?: number; body: unknown }[], setup: Setup = {}, database = new CatalogDouble(), modelUrl?: string): Promise<Run> {
  const server = await scriptedServer(replies);
  const gateway = await ModelGateway.start({ kind: "live", upstream: { baseUrl: modelUrl ?? server.baseUrl } });
  const home = mkdtempSync(join(workspace, "home-"));
  const runtime = new CopilotAgentRuntime({ endpoint: gateway, model: MODEL, homeDirectory: home });
  const root = repository();
  const before = references(root);
  try {
    const cartographer = new Cartographer({
      config: configFor(server.baseUrl, setup),
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

const happy = () => [{ body: toolCalls(MODEL, explore) }, { body: toolCalls(MODEL, [submit(SUBMISSION)]) }, { body: answer(MODEL, "Two domains: orders and customers.") }];
const messages = (outcome: CartographyOutcome) => outcome.journal.map((entry) => entry.message).join("\n");
const indexFile = (root: string) => join(root, ".oqas", "index", INDEX_FILE_NAME);

describe("criterion 1 — the cartographer writes an index that passes the schema of the index format", () => {
  it("writes the index of a contract, a base, a document and an interface, read in the environment", async () => {
    const { outcome, root } = await cartography(happy());
    assert.equal(outcome.indexPath, indexFile(root));
    const written = JSON.parse(readFileSync(indexFile(root), "utf8")) as unknown;
    assert.deepEqual(validateDomainIndex(written), { ok: true, value: outcome.index });
    assert.deepEqual(outcome.index!.sources, [
      { id: "shop-api", type: "openapi", state: "read" },
      { id: "shop-db", type: "postgresql", state: "read" },
      { id: "order-specs", type: "document", state: "read" },
      { id: "shop", type: "web", state: "read" },
    ]);
    assert.deepEqual([outcome.index!.status, outcome.index!.producedAt, outcome.index!.environment, outcome.index!.run.iterations], ["complete", "2026-11-13T10:00:00.000Z", "local", 3]);
    assert.match(messages(outcome), /The index was accepted\.\nThe index was written to .*domain-index\.json, complete\./);
  });
});

describe("criterion 2 — every tag of the contract and every table of the base is in a domain or unassigned", () => {
  it("tells the agent the items to place, and places them all", async () => {
    const { outcome, server } = await cartography(happy());
    const request = JSON.stringify(server.requests[0]!.body);
    assert.ok(request.includes(JSON.stringify(`shop-api (openapi), items to place: ${JSON.stringify(["orders", "customers", "/health"])}`).slice(1, -1)));
    assert.ok(request.includes(JSON.stringify(`shop-db (postgresql), items to place: ${JSON.stringify(TABLES.map((t) => `public.${t}`))}`).slice(1, -1)));
    const placed = [...outcome.index!.domains.flatMap((d) => d.references), ...outcome.index!.unassigned].flatMap((r) => r.items);
    for (const item of ["orders", "customers", "/health", ...TABLES.map((t) => `public.${t}`)]) assert.ok(placed.includes(item), item);
  });
});

describe("criterion 3 — an index that omits a table is not written, and the journal names the table", () => {
  it("refuses the submission, tells the agent why, and writes nothing", async () => {
    const forgetful = { ...SUBMISSION, unassigned: [{ source: "shop-api", items: ["/health"] }] };
    const { outcome, root, server } = await cartography([{ body: toolCalls(MODEL, [submit(forgetful)]) }, { body: answer(MODEL, "Done.") }]);
    assert.equal(existsSync(indexFile(root)), false);
    assert.match(messages(outcome), /The index was refused: public\.schema_migrations of shop-db is in no domain nor in unassigned\./);
    assert.match(JSON.stringify(server.requests[1]!.body), /Fix it and submit it again/);
    assert.match(messages(outcome), /No index was written: no index was accepted before the session ended\./);
  });

  it("tells at most thirty errors at once, and keeps the first index accepted", async () => {
    const many = new CatalogDouble(Array.from({ length: 40 }, (_, i) => `t${i}`));
    const refused = await cartography([{ body: toolCalls(MODEL, [submit(INVENTORIED)]) }, { body: answer(MODEL, "Done.") }], {}, many);
    assert.match(JSON.stringify(refused.server.requests[1]!.body), /and \d+ more/);
    const twice = await cartography([{ body: toolCalls(MODEL, [submit(INVENTORIED, "a"), submit(INVENTORIED, "b")]) }, { body: answer(MODEL, "Done.") }]);
    assert.match(JSON.stringify(twice.server.requests[1]!.body), /An index was already accepted/);
    assert.equal(twice.outcome.index!.status, "truncated");
  });
});

describe("criterion 4 — an index that breaks the schema is not written, and the journal names the field", () => {
  it("journals the field of a submission that breaks the schema, a missing, an empty or an extra one", async () => {
    const wrong = { domains: [{ ...INVENTORIED.domains[0]!, label: "", confidence: 0.9 }, INVENTORIED.domains[1]!] };
    const { outcome, root, server } = await cartography([{ body: toolCalls(MODEL, [submit(wrong)]) }, { body: answer(MODEL, "Done.") }]);
    assert.equal(existsSync(indexFile(root)), false);
    const text = messages(outcome);
    assert.match(text, /The index was refused: The document must have required property 'unassigned'\./);
    assert.match(text, /The index was refused: \/domains\/0\/label must NOT have fewer than 1 characters\./);
    assert.match(text, /The index was refused: \/domains\/0\/confidence is not allowed\./);
    assert.match(JSON.stringify(server.requests[1]!.body), /confidence is not allowed/);
  });

  it("refuses a repeated domain, and journals the field of a whole index that breaks the schema", async () => {
    const repeated = { ...SUBMISSION, domains: [...SUBMISSION.domains, SUBMISSION.domains[1]!] };
    const twice = await cartography([{ body: toolCalls(MODEL, [submit(repeated)]) }, { body: answer(MODEL, "Done.") }]);
    assert.match(messages(twice.outcome), /The index was refused: \/domains\/2\/id repeats the domain customers\./);
    const withoutInterface = { ...SUBMISSION, domains: SUBMISSION.domains.map((d) => ({ ...d, references: d.references.filter((r) => r.source !== "shop" && r.source !== "order-specs") })) };
    const { outcome, root } = await cartography([{ body: toolCalls(MODEL, [submit(withoutInterface)]) }, { body: answer(MODEL, "Done.") }], { environment: "" });
    assert.equal(existsSync(indexFile(root)), false);
    assert.match(messages(outcome), /The index does not match its schema: \/environment must NOT have fewer than 1 characters\.\nNo index was written\./);
  });
});

describe("criterion 5 — a declared source that does not answer stops the run before any exploration", () => {
  it("names each source in error and its cause, starts no session, writes nothing", async () => {
    const down = await closedPort();
    const failing: SqlClient = { query: () => Promise.reject("refused") };
    const { outcome, root, server } = await cartography([], { uiUrl: `http://127.0.0.1:${down}`, documents: ["specs/missing.md"] }, failing as unknown as CatalogDouble);
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
    const { outcome } = await cartography([], { uiUrl: `${site.origin}/broken`, contractUrl: `http://127.0.0.1:${down}/v3/api-docs` });
    assert.match(messages(outcome), /The source shop does not answer: .*\/broken answered with status 500\./);
    assert.match(messages(outcome), /The source shop-api does not answer: fetch failed/);
  });
});

describe("defaults of a run", () => {
  it("checks the base with PostgreSQL itself, and says when it does not answer", async () => {
    const { outcome, server } = await cartography(happy(), { realDatabase: true });
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
  it("answers the agent with an error, reaches no other host, and counts the action", async () => {
    const away = [{ id: "g1", name: "shop_goto", arguments: { url: `${elsewhere.origin}/` } }];
    const { outcome } = await cartography([{ body: toolCalls(MODEL, away) }, { body: toolCalls(MODEL, explore) }, { body: toolCalls(MODEL, [submit(SUBMISSION)]) }, { body: answer(MODEL, "Done.") }]);
    assert.deepEqual(elsewhere.requested, []);
    assert.equal(outcome.index!.run.actions, 1);
    assert.match(messages(outcome), new RegExp(`shop_goto: ${elsewhere.origin}/ is not an address of shop`));
  });
});

describe("criterion 7 — the database tool only queries the catalog", () => {
  it("sends only information_schema queries, and offers no tool that reads rows", async () => {
    const tables = [{ id: "c1", name: "shop_db_list_tables", arguments: {} }, { id: "c2", name: "shop_db_describe_table", arguments: { schema: "public", table: "orders" } }, { id: "c3", name: "shop_db_sample_rows", arguments: { schema: "public", table: "orders" } }];
    const { database, server } = await cartography([{ body: toolCalls(MODEL, tables) }, { body: toolCalls(MODEL, [submit(INVENTORIED)]) }, { body: answer(MODEL, "Done.") }]);
    assert.ok(database.queries.length >= 3);
    for (const query of database.queries) assert.match(query, /information_schema|pg_catalog/);
    const offered = (server.requests[0]!.body as { tools: { function: { name: string } }[] }).tools.map((t) => t.function.name);
    assert.ok(offered.includes("shop_db_describe_table") && !offered.some((name) => /shop_db_(sample_rows|search|query)$/.test(name)));
  });
});

describe("criterion 8 — the connection string appears in neither the index, the journal, nor the model exchanges", () => {
  it("keeps the secret out of every trace", async () => {
    const { outcome, root, server } = await cartography(happy());
    for (const trace of [readFileSync(indexFile(root), "utf8"), JSON.stringify(outcome.journal), JSON.stringify(server.requests)]) {
      assert.ok(!trace.includes("s3cret-db-pass") && !trace.includes(DB_URL));
    }
  });
});

describe("criterion 9 — past 200 actions nothing more runs, and no complete index exists", () => {
  it("stops the task at the 201st action and writes no index", async () => {
    const actions = Array.from({ length: 201 }, (_, i) => ({ id: `g${i}`, name: "shop_goto", arguments: { url: "/" } }));
    const before = site.requested.length;
    const { outcome, root } = await cartography([{ body: toolCalls(MODEL, actions) }, { body: toolCalls(MODEL, [submit(SUBMISSION)]) }], { limits: { maxIterations: 20, maxDurationMinutes: 10, maxActions: 200 } });
    assert.equal(existsSync(indexFile(root)), false);
    assert.match(messages(outcome), /\nThe task reached its actions limit\.\nNo index was written/);
    // One request checks the interface, one opens its page, then one per action that ran.
    assert.equal(site.requested.slice(before).filter((r) => r === "GET /").length, 2 + 200);
    assert.equal(outcome.journal.filter((entry) => entry.message === "shop_goto: The task reached its actions limit; the call did not run.").length, 1);
  });

  it("marks truncated an index accepted before a limit stopped the task", async () => {
    const { outcome } = await cartography([{ body: toolCalls(MODEL, [submit(INVENTORIED)]) }, { body: answer(MODEL, "Done.") }], { limits: { maxIterations: 1, maxDurationMinutes: 10, maxActions: 200 } });
    assert.deepEqual([outcome.index!.status, outcome.index!.run.iterations], ["truncated", 1]);
  });
});

describe("criterion 10 — a declared document is listed, read when the agent read it", () => {
  it("counts as read only a source whose reading tools answered, and refuses an index that refers to one not read", async () => {
    const glance = [{ id: "l1", name: "order_specs_list_sections", arguments: {} }, { id: "r1", name: "order_specs_read_section", arguments: { number: 99 } }, { id: "s1", name: "shop_snapshot", arguments: {} }];
    const { outcome, server } = await cartography([{ body: toolCalls(MODEL, glance) }, { body: toolCalls(MODEL, [submit(SUBMISSION)]) }, { body: toolCalls(MODEL, [submit(INVENTORIED, "x2")]) }, { body: answer(MODEL, "Done.") }]);
    assert.match(JSON.stringify(server.requests[2]!.body), /refers to order-specs, which you have not read; read it first, or leave it out/);
    assert.deepEqual(outcome.index!.sources.find((s) => s.id === "order-specs"), { id: "order-specs", type: "document", state: "not_read" });
    assert.deepEqual(outcome.index!.sources.find((s) => s.id === "shop"), { id: "shop", type: "web", state: "read" });
  });

  it("marks a document the agent did not read as not read, and the index as truncated", async () => {
    const { outcome } = await cartography(happy(), { documents: ["specs/orders.md", "specs/returns.md"] });
    assert.deepEqual(outcome.index!.sources.filter((s) => s.type === "document"), [
      { id: "order-specs", type: "document", state: "read" },
      { id: "specs-1", type: "document", state: "not_read" },
    ]);
    assert.equal(outcome.index!.status, "truncated");
    assert.ok(!outcome.index!.domains.some((d) => d.references.some((r) => r.source === "specs-1")));
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
  it("still writes, truncated, an index accepted before it failed", async () => {
    const { outcome } = await cartography([{ body: toolCalls(MODEL, explore) }, { body: toolCalls(MODEL, [submit(SUBMISSION)]) }, { status: 500, body: { error: { message: "overloaded" } } }]);
    assert.equal(outcome.index!.status, "truncated");
    assert.match(messages(outcome), /The index was accepted\.\nThe session failed: .*\nThe index was written to/);
    assert.ok(outcome.index!.run.iterations >= 2);
  });

  it("journals the failure of the model", async () => {
    const down = await closedPort();
    const { outcome, root } = await cartography([], {}, new CatalogDouble(), `http://127.0.0.1:${down}/v1`);
    assert.equal(existsSync(indexFile(root)), false);
    assert.match(messages(outcome), /The session failed: /);
  });
});
