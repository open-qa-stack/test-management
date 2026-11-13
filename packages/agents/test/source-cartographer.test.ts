import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { CopilotAgentRuntime, ModelGateway } from "@open-qa-stack/harness";
import { validateConfig, validateSourceCard, type Knowledge, type ResolvedConfig, type SourceCardSubmission } from "@open-qa-stack/shared";
import { answer, closedPort, scriptedServer, toolCalls, type ScriptedServer } from "@open-qa-stack/testing";
import type { SqlClient, SqlResult } from "@open-qa-stack/tools";
import { sourceCardRequest } from "../src/source-cartographer/source-cartographer-prompt.ts";
import { CARDS_FOLDER, SourceCartographer, type SourceCartographyOutcome } from "../src/index.ts";

const MODEL = "test-model";
const DB: Knowledge = { id: "shop-db", type: "postgresql", connectionStringEnv: "SHOP_DB_URL", attachments: [{ application: "shop" }] };

/** A catalog of three tables, whose structure can change, which remembers every query. */
class CatalogDouble implements SqlClient {
  public readonly queries: string[] = [];
  public extraColumn = false;

  /** {@inheritDoc SqlClient.query} */
  public async query(text: string): Promise<SqlResult> {
    this.queries.push(text);
    if (text.includes("information_schema.tables")) return rows(["schema", "table"], [["public", "orders"], ["public", "customers"], ["public", "schema_migrations"]]);
    if (text.includes("pg_constraint")) {
      return {
        columns: [],
        rows: [
          { schema: "public", table: "orders", kind: "p", columns: ["id"], referenced_schema: null, referenced_table: null, referenced_columns: [] },
          { schema: "public", table: "orders", kind: "f", columns: ["customer_id"], referenced_schema: "public", referenced_table: "customers", referenced_columns: ["id"] },
          { schema: "public", table: "customers", kind: "p", columns: ["id"], referenced_schema: null, referenced_table: null, referenced_columns: [] },
        ],
      };
    }
    if (text.includes("ORDER BY table_schema, table_name, ordinal_position")) {
      const columns: unknown[][] = [["public", "orders", "id", "bigint", false], ["public", "orders", "customer_id", "bigint", false], ["public", "orders", "status", "text", false], ["public", "customers", "id", "bigint", false], ["public", "customers", "email", "text", false]];
      if (this.extraColumn) columns.push(["public", "customers", "phone", "text", true]);
      return rows(["schema", "table", "name", "type", "nullable"], columns);
    }
    return rows(["name", "type", "nullable"], [["id", "bigint", false]]);
  }
}

function rows(columns: string[], values: unknown[][]): SqlResult {
  return { columns, rows: values.map((row) => Object.fromEntries(columns.map((column, i) => [column, row[i]]))) };
}

let workspace: string;

before(() => {
  workspace = mkdtempSync(join(tmpdir(), "oqas-source-cartographer-"));
});

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function configFor(modelUrl: string, limits = { maxIterations: 20, maxDurationMinutes: 10, maxActions: 200 }): ResolvedConfig {
  const text = JSON.stringify({
    formatVersion: 1,
    applications: [{ id: "shop", name: "Shop", type: "api", authentication: { method: "none" }, environments: [{ name: "local", apis: [{ name: "api", baseUrl: "http://127.0.0.1:1" }] }] }],
    knowledge: [DB, { id: "specs", type: "document", path: "specs.md", attachments: [{ application: "shop" }] }],
    model: { mode: "provider-key", provider: "openai", baseUrl: modelUrl, model: MODEL },
    autonomy: { level: "custom", task: limits, batch: { maxTests: 1, maxIdleRounds: 1 }, guardrailMinutes: 1 },
  });
  const result = validateConfig(text, { SHOP_DB_URL: "postgresql://shop:secret@127.0.0.1:5999/shop" });
  assert.ok(result.ok, JSON.stringify(result));
  return result.config;
}

const CARD: SourceCardSubmission = {
  domains: [
    { id: "orders", label: "Orders", description: "Orders placed by customers.", items: [{ name: "public.orders", summary: "One order and its status.", keyFields: ["status"] }] },
    { id: "customers", label: "Customers", description: "The customers of the shop.", items: [{ name: "public.customers", summary: "A customer and their email.", keyFields: ["email"] }] },
  ],
  unassigned: ["public.schema_migrations"],
};

const submit = (card: unknown, id = "c1") => ({ id, name: "submit_card", arguments: card });

interface Run {
  readonly outcome: SourceCartographyOutcome;
  readonly server: ScriptedServer;
}

interface Setup {
  readonly source?: Knowledge;
  readonly database?: SqlClient;
  readonly root?: string;
  readonly force?: boolean;
  readonly limits?: { maxIterations: number; maxDurationMinutes: number; maxActions: number };
  readonly config?: (config: ResolvedConfig) => ResolvedConfig;
  readonly modelUrl?: string;
  /** Reaches the base with PostgreSQL itself. */
  readonly realDatabase?: boolean;
  /** Dates the card with the system clock. */
  readonly systemClock?: boolean;
}

/** Maps one source against a scripted model. */
async function cartography(replies: readonly { status?: number; body: unknown }[], setup: Setup = {}): Promise<Run> {
  const server = await scriptedServer(replies);
  const gateway = await ModelGateway.start({ kind: "live", upstream: { baseUrl: setup.modelUrl ?? server.baseUrl } });
  const runtime = new CopilotAgentRuntime({ endpoint: gateway, model: MODEL, homeDirectory: mkdtempSync(join(workspace, "home-")) });
  try {
    const config = configFor(server.baseUrl, setup.limits);
    const cartographer = new SourceCartographer({
      config: setup.config === undefined ? config : setup.config(config),
      source: setup.source ?? DB,
      repositoryRoot: setup.root ?? mkdtempSync(join(workspace, "repo-")),
      env: { SHOP_DB_URL: "postgresql://shop:secret@127.0.0.1:5999/shop" },
      runtime,
      ...(setup.realDatabase === true ? {} : { sqlClient: () => setup.database ?? new CatalogDouble() }),
      ...(setup.systemClock === true ? {} : { now: () => new Date("2026-11-13T03:00:00.000Z") }),
      ...(setup.force === undefined ? {} : { force: setup.force }),
    });
    return { outcome: await cartographer.run(), server };
  } finally {
    await runtime.close();
    await gateway.close();
    await server.close();
  }
}

const messages = (outcome: SourceCartographyOutcome) => outcome.journal.map((entry) => entry.message).join("\n");
const happy = () => [{ body: toolCalls(MODEL, [{ id: "d1", name: "shop_db_describe_table", arguments: { schema: "public", table: "orders" } }]) }, { body: toolCalls(MODEL, [submit(CARD)]) }, { body: answer(MODEL, "Two domains.") }];

describe("criterion 1 — the keys of a base are read from the catalog alone", () => {
  it("gives the agent each table with its columns, primary key and foreign keys, and sends only catalog queries", async () => {
    const database = new CatalogDouble();
    const { server } = await cartography(happy(), { database });
    const request = JSON.stringify(server.requests[0]!.body);
    assert.ok(request.includes(JSON.stringify(`- public.orders (columns: 3; primaryKey: ["id"]; foreignKeys: [{"columns":["customer_id"],"references":"public.customers","referencedColumns":["id"]}])`).slice(1, -1)));
    for (const query of database.queries) assert.match(query, /information_schema|pg_catalog/);
  });
});

describe("criterion 2 — the card of a base passes its schema, places every table, and gives each its keys", () => {
  it("writes the card in the index folder, with the facts the harness read joined to each table", async () => {
    const { outcome } = await cartography(happy());
    assert.match(outcome.cardPath!, new RegExp(`\\.oqas/index/${CARDS_FOLDER}/shop-db\\.json$`));
    const written = JSON.parse(readFileSync(outcome.cardPath!, "utf8")) as unknown;
    assert.deepEqual(validateSourceCard(written), { ok: true, value: outcome.card });
    assert.deepEqual(outcome.card!.domains[0]!.items[0], {
      name: "public.orders",
      summary: "One order and its status.",
      keyFields: ["status"],
      facts: { columns: 3, primaryKey: ["id"], foreignKeys: [{ columns: ["customer_id"], references: "public.customers", referencedColumns: ["id"] }] },
    });
    assert.deepEqual([outcome.card!.status, outcome.card!.source, outcome.card!.unassigned, outcome.card!.run.iterations], ["complete", { id: "shop-db", type: "postgresql" }, ["public.schema_migrations"], 3]);
    assert.match(outcome.card!.fingerprint, /^sha256:/);
  });
});

describe("criterion 3 — a card that forgets or invents a table is refused, with the tables to place", () => {
  it("tells the agent what is wrong and what is still to place, and reads a name written after the source", async () => {
    const wrong = { domains: [{ ...CARD.domains[0]!, items: [{ name: "shop-db/public.orders", summary: "An order." }, { name: "public.invoices", summary: "Invented." }] }], unassigned: [] };
    const { outcome, server } = await cartography([{ body: toolCalls(MODEL, [submit(wrong)]) }, { body: toolCalls(MODEL, [submit(CARD, "c2")]) }, { body: answer(MODEL, "Done.") }]);
    const told = JSON.stringify(server.requests[1]!.body);
    assert.ok(told.includes("public.invoices is not an element of shop-db"));
    assert.ok(told.includes("Still to place, in a domain or in unassigned, each exactly as written:"));
    assert.ok(told.includes("public.customers") && !told.includes("public.orders is in no domain"));
    assert.match(messages(outcome), /The card was refused: public\.customers is in no domain nor in unassigned\./);
    assert.equal(outcome.card!.status, "complete");
  });

  it("journals a submission that breaks the schema, and writes nothing without an accepted card", async () => {
    const { outcome } = await cartography([{ body: toolCalls(MODEL, [submit({ domains: [] })]) }, ...Array.from({ length: 4 }, () => ({ body: answer(MODEL, "Done.") }))]);
    assert.match(messages(outcome), /The card was refused: The document must have required property 'unassigned'\./);
    assert.match(messages(outcome), /The agent stopped without an accepted card; it was reminded to hand one in\./);
    assert.match(messages(outcome), /No card was written: no card was accepted before the session ended\./);
    assert.equal(outcome.cardPath, undefined);
  });
});

describe("criterion 4 — the cartographer of a source offers only the tools of that source", () => {
  it("offers its catalog tools and submit_card, and no tool that reads rows", async () => {
    const { server } = await cartography(happy());
    const offered = (server.requests[0]!.body as { tools: { function: { name: string } }[] }).tools.map((t) => t.function.name).sort();
    assert.deepEqual(offered, ["recall", "remember", "shop_db_describe_table", "shop_db_list_tables", "submit_card"]);
  });
});

describe("freshness of a card", () => {
  it("keeps an up-to-date card without calling the model, and makes it again when forced or when the source changed", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    const database = new CatalogDouble();
    await cartography(happy(), { root, database });
    const kept = await cartography([], { root, database });
    assert.deepEqual([kept.outcome.kept, kept.server.requests.length], [true, 0]);
    assert.match(messages(kept.outcome), /The card of shop-db is up to date; it was kept\./);
    const forced = await cartography(happy(), { root, database, force: true });
    assert.equal(forced.outcome.kept, false);
    database.extraColumn = true;
    const changed = await cartography(happy(), { root, database });
    assert.deepEqual([changed.outcome.kept, changed.outcome.card!.fingerprint === forced.outcome.card!.fingerprint], [false, false]);
    writeFileSync(changed.outcome.cardPath!, "{");
    assert.equal((await cartography(happy(), { root, database })).outcome.kept, false);
  });
});

describe("what writes no card", () => {
  it("a source that does not answer, before any session", async () => {
    const failing: SqlClient = { query: () => Promise.reject("refused") };
    const { outcome, server } = await cartography([], { database: failing });
    assert.deepEqual(server.requests, []);
    assert.match(messages(outcome), /^The source shop-db does not answer: refused$/);
    const down = await cartography([], { database: { query: () => Promise.reject(new Error("connection refused")) } });
    assert.match(messages(down.outcome), /does not answer: connection refused/);
  });

  it("a kind of source that has no card yet", async () => {
    const { outcome } = await cartography([], { source: { id: "specs", type: "document", path: "specs.md", attachments: [{ application: "shop" }] } });
    assert.match(messages(outcome), /No card is made yet for a document source\./);
  });

  it("a card that would not match its schema, or a session that failed before any card", async () => {
    const invalid = await cartography(happy(), { config: (config) => ({ ...config, model: { ...config.model, model: "" } }) });
    assert.match(messages(invalid.outcome), /The card does not match its schema: \/model\/model must NOT have fewer than 1 characters\.\nNo card was written\./);
    const down = await closedPort();
    const failed = await cartography([], { modelUrl: `http://127.0.0.1:${down}/v1` });
    assert.match(messages(failed.outcome), /The session failed: /);
  });

  it("but a card accepted before a limit stopped the task is written, truncated", async () => {
    const { outcome } = await cartography([{ body: toolCalls(MODEL, [submit(CARD)]) }, { body: answer(MODEL, "Done.") }], { limits: { maxIterations: 1, maxDurationMinutes: 10, maxActions: 200 } });
    assert.equal(outcome.card!.status, "truncated");
    assert.match(messages(outcome), /The task reached its iterations limit\./);
  });
});

describe("defaults and tool errors", () => {
  it("reaches the base with PostgreSQL itself by default", async () => {
    const { outcome, server } = await cartography([], { realDatabase: true });
    assert.deepEqual(server.requests, []);
    assert.match(messages(outcome), /does not answer: The database query failed: .*ECONNREFUSED/);
  });

  it("journals a tool the agent called wrongly, and dates the card with the system clock", async () => {
    const before = Date.now();
    const wrong = [{ id: "w1", name: "shop_db_describe_table", arguments: { schema: "public" } }];
    const { outcome } = await cartography([{ body: toolCalls(MODEL, wrong) }, { body: toolCalls(MODEL, [submit(CARD)]) }, { body: answer(MODEL, "Done.") }], { systemClock: true });
    assert.match(messages(outcome), /shop_db_describe_table: The arguments do not match the schema of shop_db_describe_table/);
    assert.ok(Date.parse(outcome.card!.producedAt) >= before);
  });
});

describe("the request of a cartography", () => {
  it("lists an element without facts by its name alone", () => {
    assert.equal(sourceCardRequest("x", "postgresql", { items: ["a", "b"], facts: new Map([["b", {}]]), fingerprint: "f" }).split("\n").slice(1, 3).join("|"), "- a|- b");
  });
});
