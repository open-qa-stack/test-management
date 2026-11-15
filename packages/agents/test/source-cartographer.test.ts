import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { AgentRuntime } from "@open-qa-stack/domain";
import { CopilotAgentRuntime, ModelGateway } from "@open-qa-stack/harness";
import {
  validateConfig,
  validateSourceCard,
  validateSourceManifest,
  type Knowledge,
  type MappedKnowledge,
  type ResolvedConfig,
  type SourceCardSubmission,
  type SourceManifest,
} from "@open-qa-stack/shared";
import { answer, closedPort, scriptedServer, testSite, toolCalls, type ScriptedServer } from "@open-qa-stack/testing";
import { fingerprintOf, knowledgeInventory, MAX_SCANNED_FILES, type SourceInventory, type SqlClient, type SqlResult } from "@open-qa-stack/tools";
import { sourceCardRequest } from "../src/source-cartographer/source-cartographer-prompt.ts";
import { CARDS_FOLDER, Cartographer, mapSources, SourceCartographer, type CardSource, type SourceCartographyOutcome } from "../src/index.ts";

const MODEL = "test-model";
const DB: MappedKnowledge = { id: "shop-db", type: "postgresql", connectionStringEnv: "SHOP_DB_URL", attachments: [{ application: "shop" }] };

/** A catalog of three tables, and a view, a function and a trigger on demand, whose structure can change, which remembers every query. */
class CatalogDouble implements SqlClient {
  public readonly queries: string[] = [];
  public extraColumn = false;
  public statusType = "text";
  public view = false;
  public routineBody: string | undefined;

  /** {@inheritDoc SqlClient.query} */
  public async query(text: string): Promise<SqlResult> {
    this.queries.push(text);
    if (text.includes("information_schema.tables"))
      return rows(
        ["schema", "table"],
        [
          ["public", "orders"],
          ["public", "customers"],
          ["public", "schema_migrations"],
        ],
      );
    if (text.includes("pg_get_constraintdef") || text.includes("pg_get_indexdef")) return rows([], []);
    if (text.includes("pg_get_viewdef")) {
      const view = [["public", "open_orders", false, " SELECT id\n   FROM orders\n  WHERE status = 'open'::text;", ["id"], ["public.orders"]]];
      return rows(["schema", "view", "materialized", "definition", "columns", "reads"], this.view ? view : []);
    }
    if (text.includes("pg_get_functiondef")) {
      const definition = `CREATE OR REPLACE FUNCTION public.touch()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$ ${this.routineBody} $function$\n`;
      return rows(
        ["schema", "name", "arguments", "result", "definition", "parameters"],
        this.routineBody === undefined ? [] : [["public", "touch", "", "trigger", definition, []]],
      );
    }
    if (text.includes("pg_get_triggerdef")) {
      const definition = "CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION touch()";
      return rows(
        ["schema", "table", "name", "definition", "routine_schema", "routine_name", "routine_arguments"],
        this.routineBody === undefined ? [] : [["public", "orders", "orders_touch", definition, "public", "touch", ""]],
      );
    }
    if (text.includes("pg_constraint")) {
      return {
        columns: [],
        rows: [
          { schema: "public", table: "orders", kind: "p", columns: ["id"], referenced_schema: null, referenced_table: null, referenced_columns: [] },
          {
            schema: "public",
            table: "orders",
            kind: "f",
            columns: ["customer_id"],
            referenced_schema: "public",
            referenced_table: "customers",
            referenced_columns: ["id"],
          },
          { schema: "public", table: "customers", kind: "p", columns: ["id"], referenced_schema: null, referenced_table: null, referenced_columns: [] },
        ],
      };
    }
    if (text.includes("format_type")) {
      const columns: unknown[][] = [
        ["public", "orders", "id", "bigint", false],
        ["public", "orders", "customer_id", "bigint", false],
        ["public", "orders", "status", this.statusType, false],
        ["public", "customers", "id", "bigint", false],
        ["public", "customers", "email", "text", false],
      ];
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

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "oqas-source-cartographer-"));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function configFor(modelUrl: string, limits = { maxIterations: 20, maxMinutes: 10, maxActions: 200 }): ResolvedConfig {
  const text = JSON.stringify({
    formatVersion: 1,
    applications: [
      {
        id: "shop",
        name: "Shop",
        type: "api",
        authentication: { method: "none" },
        environments: [{ name: "local", apis: [{ name: "api", baseUrl: "http://127.0.0.1:1" }] }],
      },
    ],
    knowledge: [DB, { id: "specs", type: "document", path: "specs.md", attachments: [{ application: "shop" }] }],
    model: { mode: "provider-key", provider: "openai", baseUrl: modelUrl, model: MODEL },
    autonomy: { level: "bounded", task: limits },
  });
  const result = validateConfig(text, { SHOP_DB_URL: "postgresql://shop:s3cr3t-pw@127.0.0.1:5999/shop" });
  assert.ok(result.ok, JSON.stringify(result));
  return result.config;
}

/** A document of three sections, mapped with a card the agent hands in. */
/** A source mapped with one card, handed in with `submit_card`: the code of the shop, whose folders are its elements. */
const CODE: MappedKnowledge = { id: "specs", type: "source-code", path: "code", commands: "none", attachments: [{ application: "shop" }] };
/** The folders of the code, each with one file. */
const CODE_FOLDERS = ["Orders", "Customers", "Migrations"];
const DOMAINS = [
  { id: "orders", label: "Orders", description: "Orders placed by customers." },
  { id: "customers", label: "Customers", description: "The customers of the shop." },
];
const CARD: SourceCardSubmission = {
  domains: [
    { ...DOMAINS[0]!, items: [{ name: "Orders", summary: "How an order is placed.", keyFields: ["status"] }] },
    { ...DOMAINS[1]!, items: [{ name: "Customers", summary: "Who the customers are." }] },
  ],
  unassigned: ["Migrations"],
};

/** Where the tables of the base go: two in a domain, one set aside. */
const PLACED = [
  { name: "public.orders", domain: "orders", role: "One order and its status." },
  { name: "public.customers", domain: "customers", role: "A customer and their email." },
];
const ASIDE = { name: "public.schema_migrations", reason: "The log of the migrations." };
const place = (items: readonly unknown[], domains?: readonly unknown[], id = "p1") => ({
  id,
  name: "place_elements",
  arguments: domains === undefined ? { items } : { domains, items },
});

const submit = (card: unknown, id = "c1") => ({ id, name: "submit_card", arguments: card });

interface Run {
  readonly outcome: SourceCartographyOutcome;
  readonly server: ScriptedServer;
}

interface Setup {
  readonly source?: CardSource;
  readonly database?: SqlClient;
  readonly root?: string;
  readonly force?: boolean;
  /** The inventory read before, handed to the cartographer. */
  readonly inventory?: SourceInventory;
  readonly limits?: { maxIterations: number; maxMinutes: number; maxActions: number };
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
    const root = setup.root ?? mkdtempSync(join(workspace, "repo-"));
    if (setup.source === CODE)
      for (const folder of CODE_FOLDERS) {
        mkdirSync(join(root, "code", folder), { recursive: true });
        writeFileSync(join(root, "code", folder, "index.ts"), `export const ${folder.toLowerCase()} = 1;\n`);
      }
    const cartographer = new SourceCartographer({
      config: setup.config === undefined ? config : setup.config(config),
      source: setup.source ?? DB,
      repositoryRoot: root,
      env: { SHOP_DB_URL: "postgresql://shop:s3cr3t-pw@127.0.0.1:5999/shop" },
      runtime,
      ...(setup.realDatabase === true ? {} : { sqlClient: () => setup.database ?? new CatalogDouble() }),
      ...(setup.systemClock === true ? {} : { now: () => new Date("2026-11-13T03:00:00.000Z") }),
      ...(setup.force === undefined ? {} : { force: setup.force }),
      ...(setup.inventory === undefined ? {} : { inventory: setup.inventory }),
    });
    return { outcome: await cartographer.run(), server };
  } finally {
    await runtime.close();
    await gateway.close();
    await server.close();
  }
}

const messages = (outcome: SourceCartographyOutcome) => outcome.journal.map((entry) => entry.message).join("\n");
const manifestOf = (outcome: SourceCartographyOutcome) =>
  JSON.parse(readFileSync(join(outcome.cardPath!.replace(/\.json$/, ""), "manifest.json"), "utf8")) as SourceManifest;

/** The bodies of the files of the two domains of the base, as the model answers them. */
const ORDERS_FILE = "| Element | Role |\n|---|---|\n| `public.orders` | One order and its status. |";
const CUSTOMERS_FILE = "`public.customers` holds one row per customer, found by `email`.";
/** The base placed in one batch — a first call, then the same element set aside again to confirm it — then the file of each domain. */
const happy = () => [
  { body: toolCalls(MODEL, [place([...PLACED, ASIDE], DOMAINS)]) },
  { body: toolCalls(MODEL, [place([ASIDE], undefined, "p2")]) },
  { body: answer(MODEL, "Done.") },
  { body: answer(MODEL, ORDERS_FILE) },
  { body: answer(MODEL, CUSTOMERS_FILE) },
];
/** The document mapped with one card. */
const documented = () => [{ body: toolCalls(MODEL, [submit(CARD)]) }, { body: answer(MODEL, "Two domains.") }];

describe("the grouping of a base, batch by batch", () => {
  it("asks the model to place the elements of the batch with place_elements alone, and reads the catalog only", async () => {
    const database = new CatalogDouble();
    const { server } = await cartography(happy(), { database });
    const body = server.requests[0]!.body as { messages: { role: string; content: string }[]; tools: { function: { name: string } }[] };
    assert.deepEqual(
      body.tools.map((tool) => tool.function.name),
      ["place_elements", "remember"],
    );
    assert.ok(
      body.messages
        .find((message) => message.role === "user")!
        .content.endsWith(
          [
            "Batch 1 of 1 of the source shop-db.",
            "",
            "No domain exists yet: declare the ones this batch needs.",
            "",
            "The 3 elements to place, each named by its ### line:",
            "",
            "### public.orders",
            "table public.orders",
            "  columns: id bigint not null, customer_id bigint not null, status text not null",
            "  primary key: id",
            "  foreign keys: customer_id -> public.customers (id)",
            "",
            "### public.customers",
            "table public.customers",
            "  columns: id bigint not null, email text not null",
            "  primary key: id",
            "",
            "### public.schema_migrations",
            "table public.schema_migrations",
            "",
            "Call place_elements with these 3 elements.",
          ].join("\n"),
        ),
    );
    for (const query of database.queries) assert.match(query, /information_schema|pg_catalog/);
  });

  it("derives the card from the manifest: the role of each table as its summary, its facts, and the tables set aside in unassigned", async () => {
    const { outcome } = await cartography(happy());
    assert.match(outcome.cardPath!, new RegExp(`\\.oqas/index/${CARDS_FOLDER}/shop-db\\.json$`));
    assert.deepEqual(validateSourceCard(JSON.parse(readFileSync(outcome.cardPath!, "utf8")) as unknown), { ok: true, value: outcome.card });
    assert.deepEqual(outcome.card!.domains[0], {
      ...DOMAINS[0]!,
      items: [
        {
          name: "public.orders",
          summary: "One order and its status.",
          facts: {
            kind: "table",
            columns: 3,
            primaryKey: ["id"],
            foreignKeys: [{ columns: ["customer_id"], references: "public.customers", referencedColumns: ["id"] }],
          },
        },
      ],
    });
    assert.deepEqual(
      [outcome.card!.status, outcome.card!.source, outcome.card!.unassigned, outcome.card!.run.iterations, outcome.usage.requests],
      ["complete", { id: "shop-db", type: "postgresql" }, ["public.schema_migrations"], 5, 5],
    );
    const manifest = manifestOf(outcome);
    assert.deepEqual(
      [manifest.status, manifest.domains, manifest.fingerprint],
      ["complete", DOMAINS.map((domain) => ({ ...domain, file: `domains/${domain.id}.md`, writtenBy: "model" })), outcome.card!.fingerprint],
    );
    assert.deepEqual(
      manifest.elements.map(({ name, domain, role, dismissed }) => ({ name, domain, role, dismissed })),
      [
        { name: "public.orders", domain: "orders", role: "One order and its status.", dismissed: undefined },
        { name: "public.customers", domain: "customers", role: "A customer and their email.", dismissed: undefined },
        { name: "public.schema_migrations", domain: undefined, role: undefined, dismissed: "The log of the migrations." },
      ],
    );
    assert.match(messages(outcome), /The mapping of shop-db is complete: 2 domains, 2 elements placed, 1 set aside, 0 unplaced\./);
  });

  it("keeps what a call places validly, tells only what is wrong, and closes the batch after three calls, the rest left unplaced", async () => {
    const wrong = { name: "public.customers", domain: "people", role: "A customer." };
    const { outcome, server } = await cartography([
      { body: toolCalls(MODEL, [place([PLACED[0], wrong, { name: "public.invoices", domain: "orders", role: "Invented." }], [DOMAINS[0]])]) },
      { body: toolCalls(MODEL, [place([wrong], undefined, "p2")]) },
      { body: toolCalls(MODEL, [place([wrong], undefined, "p3")]) },
      { body: answer(MODEL, "Done.") },
      { body: answer(MODEL, ORDERS_FILE) },
    ]);
    const told = JSON.stringify(server.requests[1]!.body);
    assert.ok(told.includes("1 of 3 elements are settled."));
    assert.ok(told.includes("public.invoices is not an element of this batch."));
    assert.match(told, /Still to place: \[[^\]]*public\.customers[^\]]*public\.schema_migrations[^\]]*\]/);
    assert.ok(JSON.stringify(server.requests[3]!.body).includes("This batch is closed: 2 elements stay unplaced and will be asked again later."));
    assert.deepEqual(
      [outcome.card!.status, outcome.card!.domains.map((domain) => domain.id), outcome.card!.unassigned],
      ["truncated", ["orders"], ["public.customers", "public.schema_migrations"]],
    );
    const manifest = manifestOf(outcome);
    assert.equal(manifest.status, "truncated");
    assert.match(manifest.elements[1]!.unplaced!, /^public\.customers: the domain "people" does not exist\. Declare it in domains/);
    assert.equal(manifest.elements[2]!.unplaced, "The model had 3 calls.");
    assert.match(messages(outcome), /batch 1 of 1 was closed with 2 elements unplaced: public\.customers, public\.schema_migrations\. The model had 3 calls\./);
    assert.match(messages(outcome), /The mapping of shop-db is truncated: 1 domains, 1 elements placed, 0 set aside, 2 unplaced\./);
  });

  it("reminds a model that stops before the batch is over, and leaves unplaced what a session that fails or reaches a limit did not place", async () => {
    const reminded = await cartography([{ body: answer(MODEL, "Done.") }, ...happy()]);
    assert.ok(JSON.stringify(reminded.server.requests[1]!.body).includes("3 elements of this batch are not placed yet:"));
    assert.equal(reminded.outcome.card!.status, "complete");
    const down = await closedPort();
    const root = mkdtempSync(join(workspace, "repo-"));
    const failed = await cartography([], { root, modelUrl: `http://127.0.0.1:${down}/v1` });
    assert.match(messages(failed.outcome), /The session of batch 1 of 1 failed: [^\n]*\nbatch 1 of 1 was closed with 3 elements unplaced/);
    assert.match(messages(failed.outcome), /No card was written: no element of shop-db was placed\.$/);
    assert.deepEqual([failed.outcome.card, failed.outcome.cardPath], [undefined, undefined]);
    const left = JSON.parse(readFileSync(join(root, ".oqas", "index", CARDS_FOLDER, "shop-db", "manifest.json"), "utf8")) as SourceManifest;
    assert.deepEqual([left.status, left.elements[0]!.unplaced], ["truncated", "The session ended before they were placed."]);
    const limited = await cartography([happy()[0]!, ...happy().slice(3)], { limits: { maxIterations: 1, maxMinutes: 10, maxActions: 200 } });
    assert.match(messages(limited.outcome), /The session of batch 1 of 1 reached its iterations limit\./);
    assert.deepEqual(
      [limited.outcome.stoppedBy, limited.outcome.card!.status, limited.outcome.card!.unassigned],
      ["iterations", "truncated", ["public.schema_migrations"]],
    );
    assert.equal(manifestOf(limited.outcome).elements[2]!.unplaced, "The model set it aside and did not confirm.");
  });

  it("places the views with the tables, and the routines in the manifest only", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    const database = new CatalogDouble();
    database.view = true;
    database.routineBody = "BEGIN NEW.status := 'touched'; RETURN NEW; END";
    const more = [
      { name: "public.open_orders", domain: "orders", role: "The orders still open." },
      { name: "public.touch()", domain: "orders", role: "Marks an order as touched." },
    ];
    const script = () => [
      { body: toolCalls(MODEL, [place([...PLACED, ASIDE, ...more], DOMAINS)]) },
      { body: toolCalls(MODEL, [place([ASIDE], undefined, "p2")]) },
      { body: answer(MODEL, "Done.") },
      { body: answer(MODEL, "`public.orders`, its view `public.open_orders` and the trigger function `public.touch()`.") },
      { body: answer(MODEL, CUSTOMERS_FILE) },
    ];
    const { outcome, server } = await cartography(script(), { root, database });
    const request = (server.requests[0]!.body as { messages: { role: string; content: string }[] }).messages.find(
      (message) => message.role === "user",
    )!.content;
    assert.ok(
      request.includes(
        "### public.open_orders\nview public.open_orders\n  columns: id\n  reads: public.orders\n\n### public.touch()\nfunction public.touch() returns trigger\n",
      ),
    );
    assert.ok(request.includes("  foreign keys: customer_id -> public.customers (id)\n  triggers: orders_touch -> public.touch()\n"));
    assert.deepEqual(
      outcome.card!.domains[0]!.items.map((item) => [item.name, item.summary, item.facts!["kind"], item.facts!["triggers"]]),
      [
        ["public.orders", "One order and its status.", "table", ["orders_touch"]],
        ["public.open_orders", "The orders still open.", "view", undefined],
      ],
    );
    assert.deepEqual(outcome.card!.domains[0]!.items[1]!.facts, { kind: "view", columns: 1, reads: ["public.orders"] });
    const manifest = manifestOf(outcome);
    assert.deepEqual([manifest.status, manifest.elements.at(-1)!.name, manifest.elements.at(-1)!.domain], ["complete", "public.touch()", "orders"]);
    const folder = outcome.cardPath!.replace(/\.json$/, "");
    assert.equal(
      readFileSync(join(folder, "export", "views", "public.open_orders.sql"), "utf8"),
      "CREATE VIEW public.open_orders AS\n SELECT id\n   FROM orders\n  WHERE status = 'open'::text;\n",
    );
    const [file] = readdirSync(join(folder, "export", "routines"));
    assert.match(file!, /^public\.touch_-[0-9a-f]{8}\.sql$/);
    assert.equal(
      readFileSync(join(folder, "export", "routines", file!), "utf8"),
      "CREATE OR REPLACE FUNCTION public.touch()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$ BEGIN NEW.status := 'touched'; RETURN NEW; END $function$\n",
    );
    assert.ok(
      readFileSync(join(folder, "export", "tables", "public.orders.sql"), "utf8").endsWith(
        ");\n\nCREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION touch();\n",
      ),
    );
    assert.equal((await cartography([], { root, database })).outcome.kept, true);
    database.routineBody = "BEGIN RETURN NEW; END";
    assert.equal((await cartography(script(), { root, database })).outcome.kept, false);
  });

  it("gives a base without any element an empty, complete card and manifest, without the model", async () => {
    const empty: SqlClient = { query: async () => ({ columns: [], rows: [] }) };
    const { outcome, server } = await cartography([], { database: empty });
    assert.deepEqual([outcome.card!.status, outcome.card!.domains, outcome.card!.unassigned, server.requests.length], ["complete", [], [], 0]);
    assert.deepEqual([manifestOf(outcome).status, manifestOf(outcome).elements], ["complete", []]);
  });
});

describe("the files of the domains of a base", () => {
  it("asks the model for the body of each domain in a session that may keep a note and has no other tool, and writes the file with its header", async () => {
    const { outcome, server } = await cartography(happy());
    const asked = server.requests[3]!.body as { messages: { role: string; content: string }[]; tools: { function: { name: string } }[] };
    assert.deepEqual(
      asked.tools.map((tool) => tool.function.name),
      ["remember"],
    );
    assert.match(
      asked.messages.find((message) => message.role === "system")!.content,
      /\n- Keep with remember what the agents after you should know and no element says by itself/,
    );
    assert.ok(
      asked.messages
        .find((message) => message.role === "user")!
        .content.endsWith(
          [
            "Write the file of the domain orders of the source shop-db.",
            "",
            "Orders: Orders placed by customers.",
            "",
            "Its 1 elements, each named by its ### line, with its role:",
            "",
            "### public.orders — One order and its status.",
            "table public.orders",
            "  columns: id bigint not null, customer_id bigint not null, status text not null",
            "  primary key: id",
            "  foreign keys: customer_id -> public.customers (id)",
            "",
            "The other domains of the source:",
            "- customers — Customers: The customers of the shop.",
            "",
            "Answer with the markdown body alone.",
          ].join("\n"),
        ),
    );
    const folder = outcome.cardPath!.replace(/\.json$/, "");
    assert.equal(readFileSync(join(folder, "domains", "orders.md"), "utf8"), `# Orders (\`orders\`)\n\nOrders placed by customers.\n\n${ORDERS_FILE}\n`);
    assert.deepEqual(readdirSync(join(folder, "domains")).sort(), ["customers.md", "orders.md"]);
    assert.match(messages(outcome), /The file of the domain orders was written by the model\.\nThe file of the domain customers was written by the model\./);
  });

  it("writes a file itself when the model gives none that names its elements, keeps the refused body beside it, and ends truncated", async () => {
    const vague = { body: answer(MODEL, "This domain holds what customers buy.") };
    const { outcome, server } = await cartography([...happy().slice(0, 3), vague, vague, vague, vague, happy()[4]!]);
    assert.ok(JSON.stringify(server.requests[4]!.body).includes("The file was not kept. Fix what follows and answer again with the whole body."));
    const folder = outcome.cardPath!.replace(/\.json$/, "");
    assert.equal(
      readFileSync(join(folder, "domains", "orders.md"), "utf8"),
      "# Orders (`orders`)\n\nOrders placed by customers.\n\n| Element | Kind | Role |\n|---|---|---|\n| `public.orders` | table | One order and its status. |\n",
    );
    assert.equal(readFileSync(join(folder, "domains", "orders.refused.md"), "utf8"), "This domain holds what customers buy.\n");
    const manifest = manifestOf(outcome);
    assert.deepEqual(
      [manifest.status, outcome.card!.status, manifest.domains.map((domain) => domain.writtenBy)],
      ["truncated", "truncated", ["harness", "model"]],
    );
    assert.match(manifest.domains[0]!.refused!, /^These elements of the domain are not named: public\.orders\./);
    assert.match(messages(outcome), /The harness wrote the file of the domain orders itself: These elements of the domain are not named: public\.orders\./);
    assert.equal(outcome.usage.requests, 8);
  });
});

describe("criterion 3 — a card that forgets or invents an element is refused, with the elements to place", () => {
  it("tells the agent what is wrong and what is still to place, and reads a name written after the source", async () => {
    const wrong = {
      domains: [
        {
          ...CARD.domains[0]!,
          items: [
            { name: "specs/Orders", summary: "An order." },
            { name: "Invoices", summary: "Invented." },
          ],
        },
      ],
      unassigned: [],
    };
    const { outcome, server } = await cartography(
      [{ body: toolCalls(MODEL, [submit(wrong)]) }, { body: toolCalls(MODEL, [submit(CARD, "c2")]) }, { body: answer(MODEL, "Done.") }],
      { source: CODE },
    );
    const told = JSON.stringify(server.requests[1]!.body);
    assert.ok(told.includes("Invoices is not an element of specs"));
    assert.ok(told.includes("Still to place, in a domain or in unassigned, each exactly as written:"));
    assert.ok(told.includes("Customers") && !told.includes("Orders is in no domain"));
    assert.match(messages(outcome), /The card was refused: Customers is in no domain nor in unassigned\./);
    assert.equal(outcome.card!.status, "complete");
  });

  it("puts the elements still to place in unassigned itself after two such refusals in a row, a refusal for another reason in between counting again", async () => {
    const forgetful = { domains: [CARD.domains[0]!], unassigned: CARD.unassigned };
    const invented = {
      ...CARD,
      domains: [{ ...CARD.domains[0]!, items: [...CARD.domains[0]!.items, { name: "Invoices", summary: "Invented." }] }, CARD.domains[1]!],
    };
    const { outcome } = await cartography(
      [
        { body: toolCalls(MODEL, [submit(forgetful, "c1")]) },
        { body: toolCalls(MODEL, [submit(invented, "c2")]) },
        { body: toolCalls(MODEL, [submit(forgetful, "c3")]) },
        { body: toolCalls(MODEL, [submit(forgetful, "c4")]) },
        { body: answer(MODEL, "Done.") },
      ],
      { source: CODE },
    );
    assert.equal(messages(outcome).match(/the harness put/g)?.length, 1, messages(outcome));
    assert.match(messages(outcome), /2 submissions of the card in a row left items to place; the harness put the 1 of the latest in unassigned\./);
    assert.ok(outcome.card!.unassigned.includes("Customers"));
  });

  it("reads a card without unassigned as one that puts no element there", async () => {
    const whole = { domains: [{ ...CARD.domains[0]!, items: [...CARD.domains[0]!.items, { name: "Migrations", summary: "Migrations." }] }, CARD.domains[1]!] };
    const { outcome } = await cartography([{ body: toolCalls(MODEL, [submit(whole)]) }, { body: answer(MODEL, "Done.") }], { source: CODE });
    assert.deepEqual(outcome.card?.unassigned, [], messages(outcome));
  });

  it("journals a submission that breaks the schema, and writes nothing without an accepted card", async () => {
    const { outcome } = await cartography(
      [{ body: toolCalls(MODEL, [submit({ domains: [] })]) }, ...Array.from({ length: 4 }, () => ({ body: answer(MODEL, "Done.") }))],
      { source: CODE },
    );
    assert.match(messages(outcome), /The card was refused: \/domains must NOT have fewer than 1 items\./);
    assert.match(messages(outcome), /The agent stopped without an accepted card; it was reminded to hand one in\./);
    assert.match(messages(outcome), /No card was written: no card was accepted before the session ended\./);
    assert.equal(outcome.cardPath, undefined);
  });
});

describe("criterion 4 — the cartographer of a source offers only the tools of that source", () => {
  it("offers the tools of the code, the notes and submit_card", async () => {
    const { server } = await cartography(documented(), { source: CODE });
    const offered = (server.requests[0]!.body as { tools: { function: { name: string } }[] }).tools.map((t) => t.function.name).sort();
    assert.deepEqual(offered, ["recall", "remember", "specs_list_files", "specs_outline", "specs_read_file", "specs_search", "submit_card"]);
  });
});

describe("freshness, criterion 1 — an unchanged source is not mapped again; a changed one is", () => {
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

describe("the export of a base, written beside its card", () => {
  it("writes the summary of its tables and the definition of each in the folder of the source, the secrets of the configuration masked", async () => {
    const database = new CatalogDouble();
    database.statusType = "text DEFAULT 'postgresql://shop:s3cr3t-pw@127.0.0.1:5999/shop'";
    const { outcome, server } = await cartography(happy(), { database });
    const folder = outcome.cardPath!.replace(/\.json$/, "");
    assert.equal(
      readFileSync(join(folder, "export", "summary.txt"), "utf8"),
      [
        "table public.orders",
        "  columns: id bigint not null, customer_id bigint not null, status text DEFAULT '[secret]' not null",
        "  primary key: id",
        "  foreign keys: customer_id -> public.customers (id)",
        "",
        "table public.customers",
        "  columns: id bigint not null, email text not null",
        "  primary key: id",
        "",
        "table public.schema_migrations",
        "",
      ].join("\n"),
    );
    assert.equal(
      readFileSync(join(folder, "export", "tables", "public.orders.sql"), "utf8"),
      [
        "CREATE TABLE public.orders (",
        "  id bigint NOT NULL,",
        "  customer_id bigint NOT NULL,",
        "  status text DEFAULT '[secret]' NOT NULL,",
        "  PRIMARY KEY (id),",
        "  FOREIGN KEY (customer_id) REFERENCES public.customers (id)",
        ");",
        "",
      ].join("\n"),
    );
    assert.ok(messages(outcome).includes(`The export of shop-db and its manifest were written to ${folder}.`));
    assert.ok(!JSON.stringify(server.requests[0]!.body).includes("s3cr3t-pw"), "the request of a batch holds no secret");
  });

  it("writes the manifest, which passes its schema and gives each element the fingerprint and the file of its definition", async () => {
    const { outcome } = await cartography(happy());
    const folder = outcome.cardPath!.replace(/\.json$/, "");
    const validation = validateSourceManifest(JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")));
    assert.ok(validation.ok, JSON.stringify(validation));
    const { elements, domains: _domains, ...head } = validation.value;
    assert.deepEqual(head, {
      formatVersion: 1,
      source: { id: "shop-db", type: "postgresql" },
      fingerprint: outcome.card!.fingerprint,
      producedAt: "2026-11-13T03:00:00.000Z",
      status: "complete",
    });
    assert.deepEqual(
      elements.map((element) => [element.name, element.kind, element.file]),
      [
        ["public.orders", "table", "export/tables/public.orders.sql"],
        ["public.customers", "table", "export/tables/public.customers.sql"],
        ["public.schema_migrations", "table", "export/tables/public.schema_migrations.sql"],
      ],
    );
    for (const element of elements)
      assert.equal(fingerprintOf(readFileSync(join(folder, element.file), "utf8").slice(0, -1)), element.fingerprint, element.name);
    assert.equal(fingerprintOf(elements.map((element) => element.fingerprint).join("\n")), head.fingerprint);
  });

  it("writes a truncated manifest and card when the harness read only part of the source", async () => {
    const access = { repositoryRoot: workspace, env: { SHOP_DB_URL: "postgresql://x" }, sqlClient: () => new CatalogDouble() };
    const inventory = { ...(await knowledgeInventory(DB, access)), truncated: true };
    const { outcome } = await cartography(happy(), { inventory });
    assert.deepEqual([manifestOf(outcome).status, manifestOf(outcome).elements.length, outcome.card!.status], ["truncated", 3, "truncated"]);
  });

  it("writes no export when the card is kept, and none for a source that has none", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    const database = new CatalogDouble();
    const made = await cartography(happy(), { root, database });
    const folder = made.outcome.cardPath!.replace(/\.json$/, "");
    rmSync(folder, { recursive: true });
    const kept = await cartography([], { root, database });
    assert.deepEqual([kept.outcome.kept, existsSync(folder)], [true, false]);
    assert.doesNotMatch(messages(kept.outcome), /The export of/);
    const document = await cartography(documented(), { root, source: CODE });
    assert.deepEqual([document.outcome.card?.status, existsSync(document.outcome.cardPath!.replace(/\.json$/, ""))], ["complete", false]);
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

  it("a card that would not match its schema, or a session that failed before any card", async () => {
    for (const setup of [{}, { source: CODE }]) {
      const invalid = await cartography(setup.source === undefined ? happy() : documented(), {
        ...setup,
        config: (config) => ({ ...config, model: { ...config.model, model: "" } }),
      });
      assert.match(
        messages(invalid.outcome),
        /The card does not match its schema: \/model\/model must NOT have fewer than 1 characters\.\nNo card was written\./,
      );
      assert.equal(invalid.outcome.card, undefined);
    }
    const down = await closedPort();
    const failed = await cartography([], { source: CODE, modelUrl: `http://127.0.0.1:${down}/v1` });
    assert.match(messages(failed.outcome), /The session failed: /);
  });

  it("but a card accepted before a limit stopped the task is written, truncated", async () => {
    const { outcome } = await cartography(documented(), { source: CODE, limits: { maxIterations: 1, maxMinutes: 10, maxActions: 200 } });
    assert.equal(outcome.card!.status, "truncated");
    assert.match(messages(outcome), /The task reached its iterations limit\./);
    assert.equal(outcome.stoppedBy, "iterations");
    const none = await cartography([{ body: toolCalls(MODEL, [submit({ domains: [] })]) }, { body: answer(MODEL, "Done.") }], {
      source: CODE,
      limits: { maxIterations: 1, maxMinutes: 10, maxActions: 200 },
    });
    assert.deepEqual([none.outcome.card, none.outcome.stoppedBy], [undefined, "iterations"]);
  });
});

describe("defaults and tool errors", () => {
  it("reaches the base with PostgreSQL itself by default", async () => {
    const { outcome, server } = await cartography([], { realDatabase: true });
    assert.deepEqual(server.requests, []);
    assert.match(messages(outcome), /does not answer: The database query failed: .*ECONNREFUSED/);
  });

  it("journals a tool the agent called wrongly, for a card as for a batch, and dates the card with the system clock", async () => {
    const before = Date.now();
    const wrong = [{ id: "w1", name: "specs_read_file", arguments: {} }];
    const { outcome } = await cartography([{ body: toolCalls(MODEL, wrong) }, ...documented()], { source: CODE, systemClock: true });
    assert.match(messages(outcome), /specs_read_file: The arguments do not match the schema of specs_read_file/);
    assert.ok(Date.parse(outcome.card!.producedAt) >= before);
    const unknown = await cartography([{ body: toolCalls(MODEL, [{ id: "w1", name: "shop_db_list_tables", arguments: {} }]) }, ...happy()]);
    assert.match(messages(unknown.outcome), /shop_db_list_tables: /);
    assert.equal(unknown.outcome.card!.status, "complete");
  });
});

describe("the request of a cartography", () => {
  it("lists an element without facts by its name alone", () => {
    const request = sourceCardRequest("x", "postgresql", { items: ["a", "b"], facts: new Map([["b", {}]]), fingerprint: "f" });
    assert.equal(request.split("\n").slice(1, 3).join("|"), "- a|- b");
    assert.ok(!request.includes("indented line"));
  });
});

/** A source of each other kind, the files it reads, and a card that places all its elements. */
const KINDS: readonly {
  readonly source: MappedKnowledge;
  readonly files: Readonly<Record<string, string>>;
  readonly card: SourceCardSubmission;
  readonly facts: Readonly<Record<string, unknown>>;
}[] = [
  {
    source: { id: "shop-code", type: "source-code", path: "code", commands: "none", attachments: [{ application: "shop" }] },
    files: { "code/web/orders.js": "app.post('/orders', place);\n", "code/domain/order.ts": "export class Order {}\n" },
    card: {
      domains: [
        {
          id: "ordering",
          label: "Ordering",
          description: "Placing orders.",
          items: [
            { name: "web", summary: "The routes of the orders." },
            { name: "domain", summary: "The order itself." },
          ],
        },
      ],
      unassigned: [],
    },
    facts: { web: { files: 1, routes: ["app.post('/orders', …)"] } },
  },
];

describe("the workflow of an API contract", () => {
  it("exports its operations and its schemas, has them grouped and documented in the words of a contract, and derives the card of its operations", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    mkdirSync(join(root, "contracts"));
    const order = { $ref: "#/components/schemas/Order" };
    const paths = {
      "/orders": {
        get: { tags: ["orders"], operationId: "listOrders", responses: { "200": { content: { "application/json": { schema: order } } } } },
        post: { tags: ["orders"], requestBody: { content: { "application/json": { schema: order } } } },
      },
      "/health": { get: {} },
    };
    const schemas = { Order: { type: "object", properties: { status: { type: "string" } } } };
    writeFileSync(
      join(root, "contracts/shop.json"),
      JSON.stringify({ openapi: "3.0.3", info: { title: "Shop", version: "1" }, paths, components: { schemas } }),
    );
    const source: CardSource = { id: "shop-api", type: "openapi", path: "contracts/shop.json", attachments: [{ application: "shop" }] };
    const placed = [
      { name: "GET /orders", domain: "ordering", role: "Lists the orders." },
      { name: "POST /orders", domain: "ordering", role: "Places an order." },
      { name: "Order", domain: "ordering", role: "An order and its status." },
    ];
    const aside = { name: "GET /health", reason: "A health check." };
    const ordering = { id: "ordering", label: "Ordering", description: "Placing orders." };
    const file = "| Element | Role |\n|---|---|\n| `GET /orders` | Lists. |\n| `POST /orders` | Places an `Order`. |";
    const { outcome, server } = await cartography(
      [
        { body: toolCalls(MODEL, [place([...placed, aside], [ordering])]) },
        { body: toolCalls(MODEL, [place([aside], undefined, "p2")]) },
        { body: answer(MODEL, "Done.") },
        { body: answer(MODEL, file) },
      ],
      { source, root },
    );
    assert.ok(outcome.card, messages(outcome));
    assert.ok(validateSourceCard(JSON.parse(readFileSync(outcome.cardPath!, "utf8"))).ok);
    // The card holds the operations, each with the facts read without the model; the schemas are elements of the export only.
    assert.deepEqual(outcome.card.domains, [
      {
        ...ordering,
        items: [
          { name: "GET /orders", summary: "Lists the orders.", facts: { kind: "operation", operationId: "listOrders", tags: ["orders"] } },
          { name: "POST /orders", summary: "Places an order.", facts: { kind: "operation", tags: ["orders"] } },
        ],
      },
    ]);
    assert.deepEqual([outcome.card.unassigned, outcome.card.status], [["GET /health"], "complete"]);
    assert.deepEqual(
      manifestOf(outcome).elements.map((element) => [element.name, element.kind, element.domain]),
      [
        ["GET /orders", "operation", "ordering"],
        ["POST /orders", "operation", "ordering"],
        ["GET /health", "operation", undefined],
        ["Order", "schema", "ordering"],
      ],
    );
    const sent = (at: number) => (server.requests[at]!.body as { messages: { role: string; content: string }[] }).messages;
    const instructions = (at: number) => sent(at).find((message) => message.role === "system")!.content;
    assert.match(
      instructions(0),
      /You group the elements of one source of an application — the operations and schemas of an API contract — into functional domains/,
    );
    assert.match(instructions(0), /only when it serves no functional area: a health check, a technical schema\./);
    assert.ok(
      sent(0)
        .find((message) => message.role === "user")!
        .content.includes("### GET /orders\noperation GET /orders\n  id: listOrders\n  tags: orders\n  responses: 200 Order"),
    );
    assert.match(
      instructions(3),
      /You document one functional domain of one source of an application — the operations and schemas of an API contract — for the agents/,
    );
    assert.match(instructions(3), /between backticks: `GET \/orders\/\{orderId\}`\.\n/);
    assert.match(instructions(3), /- In code, write an operation with its method and its path, and a schema under its name, as the request does\.\n/);
  });
});

describe("the cartography of the documents of a source, by the agent that reads them", () => {
  it("gives the agent the tools of the documents, the notes and the two tools of its map, writes what it hands in, and keeps the card while the documents do not change", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    const files = {
      "docs/orders/place.md": "# Place an order\n\nA customer places an order.\n\n## Limits\n\nTen lines at most.\n",
      "docs/orders/cancel.md": "# Cancel an order\n\nBefore it ships.\n",
      "docs/changelog.md": "# Changes\n",
    };
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const source: CardSource = { id: "shop-specs", type: "document", path: "docs", attachments: [{ application: "shop" }] };
    const call = (id: string, name: string, args: object = {}) => ({ id, name, arguments: args });
    const ordering = { id: "ordering", label: "Ordering", description: "Placing and cancelling orders." };
    const elements = [
      { file: "orders/place.md", section: 2, role: "How many lines an order holds." },
      { file: "orders/cancel.md", role: "When an order may be cancelled." },
    ];
    const body = "`orders/place.md § Limits` caps an order at ten lines; `orders/cancel.md` allows a cancellation before shipping.";
    const script = () => [
      {
        body: toolCalls(MODEL, [
          call("l1", "shop_specs_list_files"),
          call("s1", "shop_specs_list_sections", { file: "orders/place.md" }),
          call("r1", "shop_specs_read_file", { file: "orders/cancel.md" }),
        ]),
      },
      {
        body: toolCalls(MODEL, [
          call("w1", "write_domain", { ...ordering, elements, body }),
          call("a1", "set_aside", { elements: [{ file: "changelog.md" }], reason: "A change log." }),
        ]),
      },
      { body: answer(MODEL, "One domain.") },
    ];
    const { outcome, server } = await cartography(script(), { source, root });
    assert.ok(outcome.card, messages(outcome));
    assert.ok(validateSourceCard(JSON.parse(readFileSync(outcome.cardPath!, "utf8"))).ok);
    // The elements are the agent's: a section of one document, another document whole.
    assert.deepEqual(outcome.card.domains, [
      {
        ...ordering,
        items: [
          { name: "orders/place.md § Limits", summary: "How many lines an order holds.", facts: { kind: "section" } },
          { name: "orders/cancel.md", summary: "When an order may be cancelled.", facts: { kind: "document" } },
        ],
      },
    ]);
    assert.deepEqual([outcome.card.unassigned, outcome.card.status], [["changelog.md"], "complete"]);
    const manifest = manifestOf(outcome);
    assert.deepEqual(
      manifest.elements.map((element) => [element.name, element.kind, element.domain ?? element.dismissed]),
      [
        ["orders/place.md § Limits", "section", "ordering"],
        ["orders/cancel.md", "document", "ordering"],
        ["changelog.md", "document", "A change log."],
      ],
    );
    const folder = outcome.cardPath!.replace(/\.json$/, "");
    assert.equal(readFileSync(join(folder, manifest.domains[0]!.file!), "utf8"), `# Ordering (\`ordering\`)\n\nPlacing and cancelling orders.\n\n${body}\n`);
    assert.equal(readFileSync(join(folder, manifest.elements[0]!.file), "utf8"), "## Limits\n\nTen lines at most.\n");
    const first = server.requests[0]!.body as { messages: { role: string; content: string }[]; tools: { function: { name: string } }[] };
    assert.deepEqual(
      first.tools.map((tool) => tool.function.name),
      [
        "shop_specs_list_files",
        "shop_specs_list_sections",
        "shop_specs_read_section",
        "shop_specs_read_file",
        "shop_specs_search",
        "remember",
        "recall",
        "write_domain",
        "set_aside",
      ],
    );
    assert.ok(
      first.messages
        .find((message) => message.role === "user")!
        .content.endsWith(
          [
            "Map the 3 documents of the source shop-specs.",
            "Folders of its root:\n- orders/ (2 documents)",
            "Documents of its root:\n- changelog.md — Changes (1 headings, 10 characters)",
            "Next: walk the tree, get an idea of each document, then hand each domain in with write_domain.",
          ].join("\n\n"),
        ),
    );
    const instructions = first.messages.find((message) => message.role === "system")!.content;
    for (const said of [
      "You map the documents of one source of an application",
      "Every team writes its documents its own way",
      "shop_specs_list_sections gives its headings without its text",
      "An element is something a test can aim at",
      "Keep with remember what the agents after you should know and no single document says",
    ])
      assert.ok(instructions.includes(said), said);
    assert.match(messages(outcome), /The mapping of shop-specs is complete: 1 domains, 2 elements placed, 1 set aside, 0 unplaced\./);
    // The card bears the fingerprint of the documents: it is kept while none changes, and made again when one does.
    const kept = await cartography([], { source, root });
    assert.deepEqual([kept.outcome.kept, kept.server.requests.length], [true, 0]);
    writeFileSync(join(root, "docs/changelog.md"), "# Changes\n\nOne more.\n");
    // The domain an earlier run left and this one does not hold loses its file; a session that fails leaves every document unplaced, and no card.
    const down = await closedPort();
    const failed = await cartography([], { source, root, modelUrl: `http://127.0.0.1:${down}/v1` });
    assert.match(messages(failed.outcome), /The session that maps shop-specs failed: /);
    assert.match(messages(failed.outcome), /3 documents or sections were left in no domain: changelog\.md, orders\/cancel\.md, orders\/place\.md\./);
    assert.match(messages(failed.outcome), /No card was written: no element of shop-specs was placed\./);
    assert.equal(existsSync(join(folder, "domains", "ordering.md")), false);
  });

  it("keeps the file of a domain mapped again, and writes it itself once the agent had three bodies refused", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "orders.md"), "# Orders\n");
    const source: CardSource = { id: "shop-specs", type: "document", path: "docs", attachments: [{ application: "shop" }] };
    const domain = { id: "orders", label: "Orders", description: "Orders.", elements: [{ file: "orders.md", role: "The orders." }] };
    const write = (id: string, body: string) => ({ body: toolCalls(MODEL, [{ id, name: "write_domain", arguments: { ...domain, body } }]) });
    const read = { body: toolCalls(MODEL, [{ id: "r1", name: "shop_specs_read_file", arguments: { file: "orders.md" } }]) };
    await cartography([read, write("w1", "`orders.md`"), { body: answer(MODEL, "Done.") }], { source, root });
    writeFileSync(join(root, "docs", "orders.md"), "# Orders\n\nChanged.\n");
    const again = await cartography([read, write("w1", "No name."), write("w2", "No name."), write("w3", "No name."), { body: answer(MODEL, "Done.") }], {
      source,
      root,
    });
    const [orders] = manifestOf(again.outcome).domains;
    assert.deepEqual(
      [orders!.id, orders!.writtenBy, orders!.refused],
      ["orders", "harness", "These elements of the domain are not named: orders.md. Name each exactly as written, between backticks, such as `orders.md`."],
    );
    const folder = again.outcome.cardPath!.replace(/\.json$/, "");
    assert.match(readFileSync(join(folder, orders!.file!), "utf8"), /\| `orders\.md` \| document \| The orders\. \|/);
    assert.equal(again.outcome.card?.status, "truncated");
  });

  it("says when a limit cut the session, and leaves the documents not placed in the card as unassigned, truncated", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "orders.md"), "# Orders\n");
    writeFileSync(join(root, "docs", "returns.md"), "# Returns\n");
    const source: CardSource = { id: "shop-specs", type: "document", path: "docs", attachments: [{ application: "shop" }] };
    const domain = { id: "orders", label: "Orders", description: "Orders.", elements: [{ file: "orders.md", role: "The orders." }], body: "`orders.md`" };
    const { outcome } = await cartography(
      [
        { body: toolCalls(MODEL, [{ id: "r1", name: "shop_specs_read_file", arguments: { file: "orders.md" } }]) },
        { body: toolCalls(MODEL, [{ id: "w1", name: "write_domain", arguments: domain }]) },
        { body: answer(MODEL, "Done.") },
      ],
      { source, root, limits: { maxIterations: 2, maxMinutes: 10, maxActions: 200 } },
    );
    assert.match(messages(outcome), /The session that maps shop-specs reached its iterations limit\./);
    assert.deepEqual([outcome.card?.status, outcome.card?.unassigned, outcome.stoppedBy], ["truncated", ["returns.md"], "iterations"]);
  });
});

describe("a card for every kind of source", () => {
  for (const kind of KINDS) {
    it(`criteria 1 and 2 — the card of a ${kind.source.type} source passes its schema, places every element, and carries the facts read without the model`, async () => {
      const root = mkdtempSync(join(workspace, "repo-"));
      for (const [path, text] of Object.entries(kind.files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
      }
      const { outcome, server } = await cartography([{ body: toolCalls(MODEL, [submit(kind.card)]) }, { body: answer(MODEL, "Done.") }], {
        source: kind.source,
        root,
      });
      assert.ok(outcome.card, messages(outcome));
      assert.ok(validateSourceCard(JSON.parse(readFileSync(outcome.cardPath!, "utf8"))).ok);
      const items = new Map(outcome.card.domains.flatMap((domain) => domain.items.map((item) => [item.name, item.facts] as const)));
      for (const [name, facts] of Object.entries(kind.facts)) assert.deepEqual(items.get(name), facts, name);
      const offered = (server.requests[0]!.body as { tools: { function: { name: string } }[] }).tools.map((tool) => tool.function.name);
      assert.ok(
        offered.every((name) => name.startsWith(kind.source.id.replaceAll("-", "_")) || ["submit_card", "remember", "recall"].includes(name)),
        offered.join(", "),
      );
    });
  }
});

describe("the card of a user interface", () => {
  const withInterface =
    (uiUrl: string) =>
    (config: ResolvedConfig): ResolvedConfig => ({
      ...config,
      applications: config.applications.map((application) => ({
        ...application,
        type: "web",
        environments: application.environments.map((environment) => ({ ...environment, uiUrl })),
      })),
    });
  it("has an agent explore the interface with the browser, hand in its domains with what it observed, and writes the card of the screens it opened", async () => {
    const site = await testSite({
      "/": '<h1>Shop</h1><a href="/orders">Orders</a><a href="/logout">Log out</a><a href="https://elsewhere.example/">Out</a>',
      "/orders": '<h1>Orders</h1><p>2 orders</p><a href="/orders/1042">ORD-1042</a><button>Delete order</button><button>Create order</button>',
      "/orders/1042": "<h1>Order ORD-1042</h1><p>Paid</p>",
    });
    try {
      const call = (id: string, name: string, args: object = {}) => ({ id, name, arguments: args });
      const ordering = { id: "ordering", label: "Ordering", description: "Browsing and reading orders." };
      const elements = [
        { screen: "/orders", role: "The list of the orders." },
        { screen: "/orders/1042", role: "One order and its state." },
      ];
      const observations = [{ screen: "/orders", statement: "The list says how many orders it holds.", shows: ["2 orders"] }];
      const body = "`/orders` lists the orders; `/orders/:id` shows one.";
      const { outcome, server } = await cartography(
        [
          { body: toolCalls(MODEL, [call("g1", "shop_goto", { url: "/" })]) },
          { body: toolCalls(MODEL, [call("g2", "shop_goto", { url: "/orders?page=2" })]) },
          // The exploration changes no data here: neither button is clicked.
          {
            body: toolCalls(MODEL, [
              call("k1", "shop_click", { target: { role: "button", name: "Delete order" }, confirm: true }),
              call("k2", "shop_click", { target: { role: "button", name: "Create order" } }),
              // A target copied from the locator of a snapshot, with its exact, is taken as it is.
              call("k3", "shop_click", { target: { role: "link", name: "ORD-1042", exact: true } }),
            ]),
          },
          { body: toolCalls(MODEL, [call("w1", "write_domain", { ...ordering, elements, observations, body })]) },
          { body: toolCalls(MODEL, [call("a1", "set_aside", { elements: [{ screen: "/" }, { screen: "/logout" }], reason: "The home and the way out." })]) },
          { body: answer(MODEL, "One domain.") },
        ],
        { source: { id: "shop", type: "web", environment: "local" }, config: withInterface(site.origin) },
      );
      assert.ok(outcome.card, messages(outcome));
      assert.ok(validateSourceCard(JSON.parse(readFileSync(outcome.cardPath!, "utf8"))).ok);
      assert.deepEqual(outcome.card.domains, [
        {
          ...ordering,
          items: [
            { name: "/orders", summary: "The list of the orders.", facts: { kind: "screen" } },
            { name: "/orders/:id", summary: "One order and its state.", facts: { kind: "screen" } },
          ],
        },
      ]);
      assert.deepEqual([outcome.card.unassigned, outcome.card.status, outcome.card.source.type], [["/", "/logout"], "complete", "web"]);
      const told = (id: string) =>
        JSON.stringify(
          server.requests
            .flatMap((request) => (request.body as { messages: { tool_call_id?: string; content?: string }[] }).messages)
            .find((message) => message.tool_call_id === id)?.content,
        );
      // Each action gives back what the page then shows; a click that removes or changes data is refused.
      assert.match(told("g1"), /heading \\+"Shop\\+"/);
      assert.match(told("k1"), /may remove data of the application, and an exploration never removes any/);
      assert.match(told("k2"), /may create or change data, and this environment is explored without changing any/);
      assert.match(told("k3"), /Order ORD-1042/);
      assert.match(told("w1"), /The domain ordering is kept with 2 elements\. 2 screens are in no domain and not set aside: \/, \/logout \(not opened\)\./);
      const manifest = manifestOf(outcome);
      const folder = outcome.cardPath!.replace(/\.json$/, "");
      assert.equal(
        readFileSync(join(folder, manifest.domains[0]!.file!), "utf8"),
        `# Ordering (\`ordering\`)\n\nBrowsing and reading orders.\n\n${body}\n\n## Observed on the screens\n\nWhat follows was seen while exploring the application, not read in a specification.\n\n- \`/orders\`: The list says how many orders it holds. Seen: "2 orders".\n`,
      );
      assert.match(readFileSync(join(folder, manifest.elements.find((element) => element.name === "/orders/:id")!.file), "utf8"), /Order ORD-1042/);
      const first = server.requests[0]!.body as { messages: { role: string; content: string }[]; tools: { function: { name: string } }[] };
      assert.ok(
        ["shop_goto", "shop_snapshot", "shop_click", "remember", "write_domain", "set_aside"].every((name) =>
          first.tools.some((tool) => tool.function.name === name),
        ),
      );
      assert.ok(first.messages.find((message) => message.role === "user")!.content.includes("Explore the user interface of shop (local), at "));
      assert.match(first.messages.find((message) => message.role === "system")!.content, /You change no data here\./);
      assert.match(messages(outcome), /The mapping of shop is complete: 1 domains, 2 elements placed, 2 set aside, 0 unplaced\./);
    } finally {
      await site.close();
    }
  });

  it("lets the agent submit a form where the environment may be changed, and says when its session failed or was cut", async () => {
    const site = await testSite({ "/": "<h1>Shop</h1><button>Create order</button>" });
    try {
      const writable = (config: ResolvedConfig): ResolvedConfig => {
        const changed = withInterface(site.origin)(config);
        return {
          ...changed,
          applications: changed.applications.map((a) => ({ ...a, environments: a.environments.map((e) => ({ ...e, exploration: "read-write" as const })) })),
        };
      };
      const source = { id: "shop", type: "web", environment: "local" } as const;
      const home = {
        id: "home",
        label: "Home",
        description: "The home.",
        elements: [{ screen: "/", role: "The home." }],
        observations: [{ screen: "/", statement: "The home names the shop.", shows: ["Shop"] }],
        body: "`/`",
      };
      const script = [
        { body: toolCalls(MODEL, [{ id: "g1", name: "shop_goto", arguments: { url: "/" } }]) },
        { body: toolCalls(MODEL, [{ id: "k1", name: "shop_click", arguments: { target: { role: "button", name: "Create order" } } }]) },
        { body: toolCalls(MODEL, [{ id: "w1", name: "write_domain", arguments: home }]) },
        { body: answer(MODEL, "Done.") },
      ];
      const { outcome, server } = await cartography(script, { source, config: writable });
      assert.equal(outcome.card?.status, "complete", messages(outcome));
      assert.match(
        (server.requests[0]!.body as { messages: { role: string; content: string }[] }).messages[0]!.content,
        /You may submit the forms that create or change data here/,
      );
      assert.doesNotMatch(JSON.stringify(server.requests[2]!.body), /Nothing was clicked/);
      // A session a limit cut leaves what was opened and not placed unplaced; one that failed opened nothing, and no card is written.
      const cut = await cartography(script, { source, config: writable, force: true, limits: { maxIterations: 1, maxMinutes: 10, maxActions: 200 } });
      assert.match(messages(cut.outcome), /The session that explores shop reached its iterations limit\./);
      assert.match(messages(cut.outcome), /No card was written: no element of shop was placed\./);
      const down = await closedPort();
      const failed = await cartography([], { source, config: writable, force: true, modelUrl: `http://127.0.0.1:${down}/v1` });
      assert.match(messages(failed.outcome), /The session that explores shop failed: /);
    } finally {
      await site.close();
    }
  });

  it("writes no card of an application without a user interface, or whose interface fails", async () => {
    const none = await cartography([], { source: { id: "shop", type: "web", environment: "local" } });
    assert.match(messages(none.outcome), /The source shop does not answer: The application shop has no user interface in the environment local\./);
    const site = await testSite({}, { "/": { status: 500, location: "/" } });
    try {
      const broken = await cartography([], { source: { id: "shop", type: "web", environment: "local" }, config: withInterface(site.origin) });
      assert.match(messages(broken.outcome), /The source shop does not answer: .* answered with status 500\./);
    } finally {
      await site.close();
    }
  });
});

describe("freshness, criterion 2 — the sources without an up-to-date card are mapped one by one, in separate tasks", () => {
  it("opens one session per source, with the tools of that source only, then keeps every card", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    writeFileSync(join(root, "specs.md"), "# Orders\n\n## Place an order\n");
    // The document is mapped by the agent that reads it, in a session of its own: it reads it, then hands its domain in.
    const ordering = { id: "ordering", label: "Ordering", description: "Placing orders.", elements: [{ file: "specs.md", role: "How an order is placed." }] };
    const specs = [
      { body: toolCalls(MODEL, [{ id: "r1", name: "specs_read_file", arguments: {} }]) },
      { body: toolCalls(MODEL, [{ id: "w1", name: "write_domain", arguments: { ...ordering, body: "`specs.md` says how an order is placed." } }]) },
      { body: answer(MODEL, "One domain.") },
    ];
    const map = async (replies: readonly { body: unknown }[], concurrency?: number) => {
      const server = await scriptedServer(replies);
      const gateway = await ModelGateway.start({ kind: "live", upstream: { baseUrl: server.baseUrl } });
      const runtime = new CopilotAgentRuntime({ endpoint: gateway, model: MODEL, homeDirectory: mkdtempSync(join(workspace, "home-")) });
      try {
        const results = await mapSources({
          config: configFor(server.baseUrl),
          environment: "local",
          repositoryRoot: root,
          env: { SHOP_DB_URL: "postgresql://shop:s3cr3t-pw@127.0.0.1:5999/shop" },
          runtime,
          sqlClient: () => new CatalogDouble(),
          ...(concurrency === undefined ? {} : { concurrency }),
        });
        return { results, server };
      } finally {
        await runtime.close();
        await gateway.close();
        await server.close();
      }
    };
    const first = await map([...happy(), ...specs]);
    assert.deepEqual(
      first.results.map(({ source, outcome }) => [source.id, outcome.kept, outcome.card?.status]),
      [
        ["shop-db", false, "complete"],
        ["specs", false, "complete"],
      ],
    );
    const toolsOf = (request: number) =>
      ((first.server.requests[request]!.body as { tools?: { function: { name: string } }[] }).tools ?? []).map((tool) => tool.function.name);
    // The sessions that place a batch and that write the file of a domain keep a note, and get no tool of the base.
    assert.deepEqual([toolsOf(0), toolsOf(3)], [["place_elements", "remember"], ["remember"]]);
    assert.ok(toolsOf(5).includes("specs_read_section") && toolsOf(5).includes("write_domain") && !toolsOf(5).some((name) => name.startsWith("shop_db_")));
    assert.equal((first.server.requests[5]!.body as { messages: unknown[] }).messages.length, 2, "the second source starts a session of its own");
    const again = await map([], 2);
    assert.deepEqual([again.results.map(({ outcome }) => outcome.kept), again.server.requests.length], [[true, true], 0]);
  });

  it("keeps the card of a user interface until it is forced", async () => {
    const site = await testSite({ "/": "<h1>Shop</h1>" });
    try {
      const root = mkdtempSync(join(workspace, "repo-"));
      const setup = {
        source: { id: "shop", type: "web", environment: "local" } as const,
        root,
        config: (config: ResolvedConfig): ResolvedConfig => ({
          ...config,
          applications: config.applications.map((a) => ({ ...a, type: "web", environments: a.environments.map((e) => ({ ...e, uiUrl: site.origin })) })),
        }),
      };
      const home = {
        id: "home",
        label: "Home",
        description: "The home page.",
        elements: [{ screen: "/", role: "The home page." }],
        observations: [{ screen: "/", statement: "The home names the shop.", shows: ["Shop"] }],
        body: "`/`",
      };
      const script = () => [
        { body: toolCalls(MODEL, [{ id: "g1", name: "shop_goto", arguments: { url: "/" } }]) },
        { body: toolCalls(MODEL, [{ id: "w1", name: "write_domain", arguments: home }]) },
        { body: answer(MODEL, "Done.") },
      ];
      assert.equal((await cartography(script(), setup)).outcome.kept, false);
      assert.equal((await cartography([], setup)).outcome.kept, true);
      assert.equal((await cartography(script(), { ...setup, force: true })).outcome.kept, false);
      const unused: AgentRuntime = { openSession: () => Promise.reject(new Error("no session expected")), close: async () => undefined };
      const config = setup.config({ ...configFor("http://127.0.0.1:1"), knowledge: [] });
      const results = await mapSources({ config, environment: "local", repositoryRoot: root, env: {}, runtime: unused });
      assert.deepEqual(
        results.map(({ source, outcome }) => [source, outcome.kept]),
        [[{ id: "shop", type: "web", environment: "local" }, true]],
      );
    } finally {
      await site.close();
    }
  });
});

describe("single read, criterion 2 — a card is made of the inventory read before, without reading the source again", () => {
  it("writes the card of a code folder removed since its inventory was read, with the fingerprint of that inventory", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    mkdirSync(join(root, "code", "app", "models"), { recursive: true });
    writeFileSync(join(root, "code", "app", "models", "user.ts"), "export class User {}\n");
    const source: MappedKnowledge = { id: "app", type: "source-code", path: "code", commands: "none", attachments: [{ application: "shop" }] };
    const inventory = await knowledgeInventory(source, { repositoryRoot: root, env: {} });
    rmSync(join(root, "code"), { recursive: true });
    const card = {
      domains: [{ id: "users", label: "Users", description: "The users.", items: [{ name: "app/models", summary: "The models." }] }],
      unassigned: [],
    };
    const { outcome } = await cartography([{ body: toolCalls(MODEL, [submit(card)]) }, { body: answer(MODEL, "Done.") }], { source, root, inventory });
    assert.deepEqual([outcome.card?.status, outcome.card?.fingerprint], ["complete", inventory.fingerprint], messages(outcome));
  });
});

describe("sources a card must still be made of", () => {
  it("gives a source without any element an empty, complete card, without the model", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    mkdirSync(join(root, "notes"));
    writeFileSync(join(root, "notes", "readme.txt"), "Just text, no code.\n");
    const { outcome, server } = await cartography([], {
      source: { id: "notes", type: "source-code", path: "notes", commands: "none", attachments: [{ application: "shop" }] },
      root,
    });
    assert.deepEqual([outcome.card?.status, outcome.card?.domains, outcome.card?.unassigned, server.requests.length], ["complete", [], [], 0]);
    assert.match(messages(outcome), /The source notes has no element; its card is empty\./);
  });

  it("keeps the exact name of an element that starts with the name of its source", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    mkdirSync(join(root, "code", "app", "models"), { recursive: true });
    writeFileSync(join(root, "code", "app", "models", "user.ts"), "export class User {}\n");
    const card = {
      domains: [{ id: "users", label: "Users", description: "The users.", items: [{ name: "app/models", summary: "The models." }] }],
      unassigned: [],
    };
    const { outcome } = await cartography([{ body: toolCalls(MODEL, [submit(card)]) }, { body: answer(MODEL, "Done.") }], {
      source: { id: "app", type: "source-code", path: "code", commands: "none", attachments: [{ application: "shop" }] },
      root,
    });
    assert.deepEqual(
      outcome.card?.domains[0]!.items.map((item) => item.name),
      ["app/models"],
      messages(outcome),
    );
  });

  it("refuses a card that holds a secret of the configuration, without repeating it", async () => {
    const secret = "postgresql://shop:s3cr3t-pw@127.0.0.1:5999/shop";
    const leaky = {
      domains: [{ ...CARD.domains[0]!, items: [{ ...CARD.domains[0]!.items[0]!, summary: `Read with ${secret}.` }] }, CARD.domains[1]!],
      unassigned: [...CARD.unassigned, secret],
    };
    const { outcome, server } = await cartography(
      [{ body: toolCalls(MODEL, [submit(leaky)]) }, { body: toolCalls(MODEL, [submit(CARD, "c2")]) }, { body: answer(MODEL, "Done.") }],
      { source: CODE },
    );
    assert.match(messages(outcome), /The card was refused: \/domains\/0\/items\/0\/summary holds a secret of the configuration; write it without the secret\./);
    assert.ok(outcome.card);
    for (const trace of [readFileSync(outcome.cardPath!, "utf8"), messages(outcome)]) assert.ok(!trace.includes("s3cr3t-pw"));
    assert.match(messages(outcome), /\[secret\] is not an element of specs/);
    assert.ok(
      !JSON.stringify(server.requests[1]!.body)
        .split("tool_call_id")
        .slice(1)
        .some((part) => part.includes("s3cr3t-pw")),
      "the refusal does not repeat the secret",
    );
    assert.ok(outcome.journal.filter((entry) => entry.message.startsWith("The card was")).every((entry) => entry.source === "specs"));
  });
});

describe("how mapSources runs the tasks", () => {
  it("runs one task at a time when the number asked is not a whole number above zero, in the order of the configuration", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    // Two folders of documents that hold none a reader reads: sources without any element, mapped without the model.
    for (const name of ["a", "b"]) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, "notes.txt"), "No document.\n");
    }
    const unused: AgentRuntime = { openSession: () => Promise.reject(new Error("no session expected")), close: async () => undefined };
    const documents = ["a", "b"].map((id): Knowledge => ({ id, type: "document", path: id, attachments: [{ application: "shop" }] }));
    const config = { ...configFor("http://127.0.0.1:1"), knowledge: documents };
    const run = (concurrency?: number) =>
      mapSources({ config, environment: "local", repositoryRoot: root, env: {}, runtime: unused, ...(concurrency === undefined ? {} : { concurrency }) });
    for (const concurrency of [Number.NaN, 0, -2, 1.5, 2])
      assert.deepEqual(
        (await run(concurrency)).map(({ source }) => source.id),
        ["a", "b"],
      );
  });

  it("maps every other source before it throws the failure of one", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    // Two folders of documents that hold none a reader reads: sources without any element, mapped without the model.
    for (const name of ["a", "b"]) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, "notes.txt"), "No document.\n");
    }
    mkdirSync(join(root, ".oqas", "index", "sources", "a.json"), { recursive: true });
    const unused: AgentRuntime = { openSession: () => Promise.reject(new Error("no session expected")), close: async () => undefined };
    const documents = ["a", "b"].map((id): Knowledge => ({ id, type: "document", path: id, attachments: [{ application: "shop" }] }));
    await assert.rejects(
      mapSources({
        config: { ...configFor("http://127.0.0.1:1"), knowledge: documents },
        environment: "local",
        repositoryRoot: root,
        env: {},
        runtime: unused,
      }),
      /EISDIR/,
    );
    assert.ok(existsSync(join(root, ".oqas", "index", "sources", "b.json")));
  });
});

describe("what no index is made of", () => {
  it("writes no index when the sources were mapped into no domain, without consolidating", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    mkdirSync(join(root, "notes"));
    writeFileSync(join(root, "notes", "readme.txt"), "No document.\n");
    const unused: AgentRuntime = { openSession: () => Promise.reject(new Error("no session expected")), close: async () => undefined };
    const config = {
      ...configFor("http://127.0.0.1:1"),
      knowledge: [{ id: "notes", type: "document", path: "notes", attachments: [{ application: "shop" }] } as Knowledge],
    };
    const outcome = await new Cartographer({ config, environment: "local", repositoryRoot: root, env: {}, runtime: unused }).run();
    assert.equal(outcome.index, undefined);
    assert.match(outcome.journal.map((entry) => entry.message).join("\n"), /No index was written: the sources were mapped into no domain\./);
  });

  it("truncates the card of source code too large to be read whole", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    mkdirSync(join(root, "code"));
    for (let i = 0; i <= MAX_SCANNED_FILES; i++) writeFileSync(join(root, "code", `f${i}.txt`), "");
    const { outcome } = await cartography([], {
      source: { id: "big", type: "source-code", path: "code", commands: "none", attachments: [{ application: "shop" }] },
      root,
    });
    assert.equal(outcome.card?.status, "truncated");
    assert.match(messages(outcome), /The source big is too large to be read whole; its card is truncated\./);
  });
});
