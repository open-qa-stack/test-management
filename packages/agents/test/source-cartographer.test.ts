import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { AgentRuntime } from "@open-qa-stack/domain";
import { CopilotAgentRuntime, ModelGateway } from "@open-qa-stack/harness";
import {
  validateConfig,
  validateSourceCard,
  type Knowledge,
  type MappedKnowledge,
  type ResolvedConfig,
  type SourceCardSubmission,
} from "@open-qa-stack/shared";
import { answer, closedPort, scriptedServer, testSite, toolCalls, type ScriptedServer } from "@open-qa-stack/testing";
import { knowledgeInventory, MAX_SCANNED_FILES, type SourceInventory, type SqlClient, type SqlResult } from "@open-qa-stack/tools";
import { sourceCardRequest } from "../src/source-cartographer/source-cartographer-prompt.ts";
import { CARDS_FOLDER, Cartographer, mapSources, SourceCartographer, type CardSource, type SourceCartographyOutcome } from "../src/index.ts";

const MODEL = "test-model";
const DB: MappedKnowledge = { id: "shop-db", type: "postgresql", connectionStringEnv: "SHOP_DB_URL", attachments: [{ application: "shop" }] };

/** A catalog of three tables, whose structure can change, which remembers every query. */
class CatalogDouble implements SqlClient {
  public readonly queries: string[] = [];
  public extraColumn = false;

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
    if (text.includes("ORDER BY table_schema, table_name, ordinal_position")) {
      const columns: unknown[][] = [
        ["public", "orders", "id", "bigint", false],
        ["public", "orders", "customer_id", "bigint", false],
        ["public", "orders", "status", "text", false],
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

before(() => {
  workspace = mkdtempSync(join(tmpdir(), "oqas-source-cartographer-"));
});

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function configFor(modelUrl: string, limits = { maxIterations: 20, maxDurationMinutes: 10, maxActions: 200 }): ResolvedConfig {
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
    autonomy: { level: "custom", task: limits, batch: { maxTests: 1, maxIdleRounds: 1 }, guardrailMinutes: 1 },
  });
  const result = validateConfig(text, { SHOP_DB_URL: "postgresql://shop:s3cr3t-pw@127.0.0.1:5999/shop" });
  assert.ok(result.ok, JSON.stringify(result));
  return result.config;
}

const CARD: SourceCardSubmission = {
  domains: [
    {
      id: "orders",
      label: "Orders",
      description: "Orders placed by customers.",
      items: [{ name: "public.orders", summary: "One order and its status.", keyFields: ["status"] }],
    },
    {
      id: "customers",
      label: "Customers",
      description: "The customers of the shop.",
      items: [{ name: "public.customers", summary: "A customer and their email.", keyFields: ["email"] }],
    },
  ],
  unassigned: ["public.schema_migrations"],
};

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
const happy = () => [
  { body: toolCalls(MODEL, [{ id: "d1", name: "shop_db_describe_table", arguments: { schema: "public", table: "orders" } }]) },
  { body: toolCalls(MODEL, [submit(CARD)]) },
  { body: answer(MODEL, "Two domains.") },
];

describe("criterion 1 — the keys of a base are read from the catalog alone", () => {
  it("gives the agent each table with its columns, primary key and foreign keys, and sends only catalog queries", async () => {
    const database = new CatalogDouble();
    const { server } = await cartography(happy(), { database });
    const request = JSON.stringify(server.requests[0]!.body);
    assert.ok(
      request.includes(
        JSON.stringify(
          `- public.orders (columns: 3; primaryKey: ["id"]; foreignKeys: [{"columns":["customer_id"],"references":"public.customers","referencedColumns":["id"]}])`,
        ).slice(1, -1),
      ),
    );
    assert.ok(request.includes(JSON.stringify(`Its 3 elements, with what is already known of each:`).slice(1, -1)));
    assert.ok(
      request.includes(
        JSON.stringify(
          `The elements to place are exactly these names: ["public.orders","public.customers","public.schema_migrations"]. What follows each name in parentheses is known facts, not elements.`,
        ).slice(1, -1),
      ),
    );
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
    assert.deepEqual(
      [outcome.card!.status, outcome.card!.source, outcome.card!.unassigned, outcome.card!.run.iterations],
      ["complete", { id: "shop-db", type: "postgresql" }, ["public.schema_migrations"], 3],
    );
    assert.match(outcome.card!.fingerprint, /^sha256:/);
  });
});

describe("criterion 3 — a card that forgets or invents a table is refused, with the tables to place", () => {
  it("tells the agent what is wrong and what is still to place, and reads a name written after the source", async () => {
    const wrong = {
      domains: [
        {
          ...CARD.domains[0]!,
          items: [
            { name: "shop-db/public.orders", summary: "An order." },
            { name: "public.invoices", summary: "Invented." },
          ],
        },
      ],
      unassigned: [],
    };
    const { outcome, server } = await cartography([
      { body: toolCalls(MODEL, [submit(wrong)]) },
      { body: toolCalls(MODEL, [submit(CARD, "c2")]) },
      { body: answer(MODEL, "Done.") },
    ]);
    const told = JSON.stringify(server.requests[1]!.body);
    assert.ok(told.includes("public.invoices is not an element of shop-db"));
    assert.ok(told.includes("Still to place, in a domain or in unassigned, each exactly as written:"));
    assert.ok(told.includes("public.customers") && !told.includes("public.orders is in no domain"));
    assert.match(messages(outcome), /The card was refused: public\.customers is in no domain nor in unassigned\./);
    assert.equal(outcome.card!.status, "complete");
  });

  it("reads a card without unassigned as one that puts no element there", async () => {
    const { outcome } = await cartography([
      {
        body: toolCalls(MODEL, [
          submit({
            domains: [
              { ...CARD.domains[0]!, items: [...CARD.domains[0]!.items, { name: "public.schema_migrations", summary: "Migrations." }] },
              CARD.domains[1]!,
            ],
          }),
        ]),
      },
      { body: answer(MODEL, "Done.") },
    ]);
    assert.deepEqual(outcome.card?.unassigned, [], messages(outcome));
  });

  it("journals a submission that breaks the schema, and writes nothing without an accepted card", async () => {
    const { outcome } = await cartography([
      { body: toolCalls(MODEL, [submit({ domains: [] })]) },
      ...Array.from({ length: 4 }, () => ({ body: answer(MODEL, "Done.") })),
    ]);
    assert.match(messages(outcome), /The card was refused: \/domains must NOT have fewer than 1 items\./);
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
    const invalid = await cartography(happy(), { config: (config) => ({ ...config, model: { ...config.model, model: "" } }) });
    assert.match(
      messages(invalid.outcome),
      /The card does not match its schema: \/model\/model must NOT have fewer than 1 characters\.\nNo card was written\./,
    );
    const down = await closedPort();
    const failed = await cartography([], { modelUrl: `http://127.0.0.1:${down}/v1` });
    assert.match(messages(failed.outcome), /The session failed: /);
  });

  it("but a card accepted before a limit stopped the task is written, truncated", async () => {
    const { outcome } = await cartography([{ body: toolCalls(MODEL, [submit(CARD)]) }, { body: answer(MODEL, "Done.") }], {
      limits: { maxIterations: 1, maxDurationMinutes: 10, maxActions: 200 },
    });
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
    const { outcome } = await cartography([{ body: toolCalls(MODEL, wrong) }, { body: toolCalls(MODEL, [submit(CARD)]) }, { body: answer(MODEL, "Done.") }], {
      systemClock: true,
    });
    assert.match(messages(outcome), /shop_db_describe_table: The arguments do not match the schema of shop_db_describe_table/);
    assert.ok(Date.parse(outcome.card!.producedAt) >= before);
  });
});

describe("the request of a cartography", () => {
  it("lists an element without facts by its name alone", () => {
    const request = sourceCardRequest("x", "postgresql", { items: ["a", "b"], facts: new Map([["b", {}]]), fingerprint: "f" });
    assert.equal(request.split("\n").slice(1, 3).join("|"), "- a|- b");
    assert.ok(!request.includes("indented line"));
  });
});

describe("faster cartography — the request of a card gives the agent what the harness already read", () => {
  it("gives the columns of each table under it, and still offers the tools of the base", async () => {
    const { server } = await cartography(happy(), { database: new CatalogDouble() });
    const request = (server.requests[0]!.body as { messages: { role: string; content: string }[] }).messages.find(
      (message) => message.role === "user",
    )!.content;
    assert.match(request, /\n- public\.orders \([^\n]*\)\n  id bigint not null, customer_id bigint not null, status text not null\n- public\.customers /);
    assert.match(request, /The indented line under a name is what the harness already read of it\. Call a tool only for what this request does not show/);
    assert.ok((server.requests[0]!.body as { tools: { function: { name: string } }[] }).tools.some((tool) => tool.function.name === "shop_db_describe_table"));
  });

  it("gives the start of each section of a document under its name", () => {
    const request = sourceCardRequest("specs", "document", {
      items: ["Orders", "Returns"],
      facts: new Map([["Orders", { number: 1, level: 1 }]]),
      excerpts: new Map([["Orders", "A customer places an order."]]),
      fingerprint: "f",
    });
    assert.equal(request.split("\n").slice(1, 4).join("|"), "- Orders (number: 1; level: 1)|  A customer places an order.|- Returns");
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
    source: { id: "shop-api", type: "openapi", path: "contracts/shop.json", attachments: [{ application: "shop" }] },
    files: {
      "contracts/shop.json": JSON.stringify({
        openapi: "3.0.3",
        info: { title: "Shop", version: "1" },
        paths: { "/orders": { get: { tags: ["orders"] }, post: { tags: ["orders"] } }, "/health": { get: {} } },
      }),
    },
    card: {
      domains: [{ id: "ordering", label: "Ordering", description: "Placing orders.", items: [{ name: "orders", summary: "Lists and places orders." }] }],
      unassigned: ["/health"],
    },
    facts: { orders: { operations: ["GET /orders", "POST /orders"] } },
  },
  {
    source: { id: "shop-specs", type: "document", path: "specs/shop.md", attachments: [{ application: "shop" }] },
    files: { "specs/shop.md": "# Orders\n\n## Place an order\n\nText.\n\n### Detail\n\n# Customers\n" },
    card: {
      domains: [
        {
          id: "ordering",
          label: "Ordering",
          description: "Placing orders.",
          items: [
            { name: "Orders", summary: "The orders." },
            { name: "Place an order", summary: "How an order is placed." },
          ],
        },
      ],
      unassigned: ["Customers"],
    },
    facts: { "Place an order": { number: 2, level: 2 } },
  },
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
  const SCREENS: SourceCardSubmission = {
    domains: [
      {
        id: "ordering",
        label: "Ordering",
        description: "Browsing orders.",
        items: [
          { name: "/", summary: "The home page." },
          { name: "/orders", summary: "The list of orders." },
        ],
      },
    ],
    unassigned: [],
  };

  it("criteria 1 and 2 — places every screen visited, refuses a card that forgets one, and carries the titles and links the snapshots showed", async () => {
    const site = await testSite({ "/": '<h1>Shop</h1><a href="/orders">Orders</a><a href="https://elsewhere.example/">Out</a>', "/orders": "<h1>Orders</h1>" });
    try {
      const { outcome, server } = await cartography(
        [
          { body: toolCalls(MODEL, [{ id: "g1", name: "shop_goto", arguments: { url: "/" } }]) },
          { body: toolCalls(MODEL, [{ id: "s1", name: "shop_snapshot", arguments: {} }]) },
          { body: toolCalls(MODEL, [{ id: "g2", name: "shop_goto", arguments: { url: "/orders?page=2" } }]) },
          { body: toolCalls(MODEL, [submit({ domains: [{ ...SCREENS.domains[0]!, items: [SCREENS.domains[0]!.items[0]!] }], unassigned: [] })]) },
          { body: toolCalls(MODEL, [submit(SCREENS, "c2")]) },
          { body: answer(MODEL, "Done.") },
        ],
        { source: { id: "shop", type: "web", environment: "local" }, config: withInterface(site.origin) },
      );
      assert.ok(outcome.card, messages(outcome));
      assert.match(JSON.stringify(server.requests[4]!.body), /Still to place[^}]*\/orders/);
      const items = outcome.card.domains[0]!.items;
      assert.deepEqual(
        items.map((item) => item.facts),
        [
          { title: "/", links: ["/orders"] },
          { title: "/orders", links: [] },
        ],
      );
      assert.equal(outcome.card.source.type, "web");
      assert.ok(outcome.card.run.actions >= 2);
      assert.match(outcome.cardPath!, /sources\/shop\.json$/);
      assert.match(JSON.stringify(server.requests[0]!.body), /Write the card of the user interface of shop \(local\)/);
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
    const specs: SourceCardSubmission = {
      domains: [{ id: "ordering", label: "Ordering", description: "Placing orders.", items: [{ name: "Orders", summary: "The orders." }] }],
      unassigned: ["Place an order"],
    };
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
    const first = await map([...happy(), { body: toolCalls(MODEL, [submit(specs)]) }, { body: answer(MODEL, "One domain.") }]);
    assert.deepEqual(
      first.results.map(({ source, outcome }) => [source.id, outcome.kept, outcome.card?.status]),
      [
        ["shop-db", false, "complete"],
        ["specs", false, "complete"],
      ],
    );
    const toolsOf = (request: number) =>
      (first.server.requests[request]!.body as { tools: { function: { name: string } }[] }).tools.map((tool) => tool.function.name);
    assert.ok(toolsOf(0).includes("shop_db_describe_table") && !toolsOf(0).some((name) => name.startsWith("specs_")));
    assert.ok(toolsOf(3).includes("specs_read_section") && !toolsOf(3).some((name) => name.startsWith("shop_db_")));
    assert.equal((first.server.requests[3]!.body as { messages: unknown[] }).messages.length, 2, "the second source starts a session of its own");
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
      const card = {
        domains: [{ id: "home", label: "Home", description: "The home page.", items: [{ name: "/", summary: "The home page." }] }],
        unassigned: [],
      };
      const script = () => [
        { body: toolCalls(MODEL, [{ id: "g1", name: "shop_goto", arguments: { url: "/" } }]) },
        { body: toolCalls(MODEL, [submit(card)]) },
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
    writeFileSync(join(root, "notes.md"), "Just text, no heading.\n");
    const { outcome, server } = await cartography([], {
      source: { id: "notes", type: "document", path: "notes.md", attachments: [{ application: "shop" }] },
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
    const { outcome, server } = await cartography([
      { body: toolCalls(MODEL, [submit(leaky)]) },
      { body: toolCalls(MODEL, [submit(CARD, "c2")]) },
      { body: answer(MODEL, "Done.") },
    ]);
    assert.match(messages(outcome), /The card was refused: \/domains\/0\/items\/0\/summary holds a secret of the configuration; write it without the secret\./);
    assert.ok(outcome.card);
    for (const trace of [readFileSync(outcome.cardPath!, "utf8"), messages(outcome)]) assert.ok(!trace.includes("s3cr3t-pw"));
    assert.match(messages(outcome), /\[secret\] is not an element of shop-db/);
    assert.ok(
      !JSON.stringify(server.requests[1]!.body)
        .split("tool_call_id")
        .slice(1)
        .some((part) => part.includes("s3cr3t-pw")),
      "the refusal does not repeat the secret",
    );
    assert.ok(outcome.journal.filter((entry) => entry.message.startsWith("The card was")).every((entry) => entry.source === "shop-db"));
  });
});

describe("how mapSources runs the tasks", () => {
  it("runs one task at a time when the number asked is not a whole number above zero, in the order of the configuration", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    for (const name of ["a.md", "b.md"]) writeFileSync(join(root, name), "No heading.\n");
    const unused: AgentRuntime = { openSession: () => Promise.reject(new Error("no session expected")), close: async () => undefined };
    const documents = ["a", "b"].map((id): Knowledge => ({ id, type: "document", path: `${id}.md`, attachments: [{ application: "shop" }] }));
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
    for (const name of ["a.md", "b.md"]) writeFileSync(join(root, name), "No heading.\n");
    mkdirSync(join(root, ".oqas", "index", "sources", "a.json"), { recursive: true });
    const unused: AgentRuntime = { openSession: () => Promise.reject(new Error("no session expected")), close: async () => undefined };
    const documents = ["a", "b"].map((id): Knowledge => ({ id, type: "document", path: `${id}.md`, attachments: [{ application: "shop" }] }));
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
  it("writes no index when the cards hold no element, without consolidating", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    writeFileSync(join(root, "notes.md"), "No heading.\n");
    const unused: AgentRuntime = { openSession: () => Promise.reject(new Error("no session expected")), close: async () => undefined };
    const config = {
      ...configFor("http://127.0.0.1:1"),
      knowledge: [{ id: "notes", type: "document", path: "notes.md", attachments: [{ application: "shop" }] } as Knowledge],
    };
    const outcome = await new Cartographer({ config, environment: "local", repositoryRoot: root, env: {}, runtime: unused }).run();
    assert.equal(outcome.index, undefined);
    assert.match(outcome.journal.map((entry) => entry.message).join("\n"), /No index was written: the cards hold no element\./);
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
