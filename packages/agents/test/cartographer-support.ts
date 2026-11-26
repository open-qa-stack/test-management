import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { CopilotAgentRuntime, ModelGateway } from "@open-qa-stack/harness";
import {
  validateConfig,
  type KnowledgeBaseSubmission,
  type MappedKnowledge,
  type ResolvedConfig,
  type SourceCard,
  type SourceCardSubmission,
  type TraceLine,
} from "@open-qa-stack/domain";
import { answer, KeptMemories, scriptedServer, testSite, toolCalls, type ScriptedServer, type TestSite } from "@open-qa-stack/testing";
import { fingerprintOf, knowledgeInventory, type SqlClient } from "@open-qa-stack/tools";
import { Cartographer, KNOWLEDGE_BASE_FILE_NAME, type CartographyOutcome, type Inbox } from "../src/index.ts";

export const MODEL = "test-model";

export const DB_URL = "postgresql://shop:s3cret-db-pass@127.0.0.1:5999/shop";

export const TABLES = ["orders", "order_lines", "customers", "schema_migrations"];

export const CONTRACT = {
  openapi: "3.0.3",
  info: { title: "Shop", version: "1" },
  paths: {
    "/orders": { get: { operationId: "listOrders", tags: ["orders"], responses: { "200": { description: "OK" } } } },
    "/customers": { get: { operationId: "listCustomers", tags: ["customers"], responses: { "200": { description: "OK" } } } },
    "/health": { get: { operationId: "health", responses: { "200": { description: "OK" } } } },
  },
};

/** A database that answers the catalog queries with fixed tables, and remembers every query. */
export class CatalogDouble implements SqlClient {
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

export const elsewhere: TestSite = await testSite({ "/": "<p>Elsewhere</p>" });

export const site: TestSite = await testSite(
  { "/": '<h1>Shop</h1><a href="/orders">Orders</a>', "/orders": "<h1>Orders</h1>" },
  { "/broken": { status: 500, location: "/" } },
);

export const workspace = mkdtempSync(join(tmpdir(), "oqas-cartographer-"));

afterAll(async () => {
  await site.close();
  await elsewhere.close();
  rmSync(workspace, { recursive: true, force: true });
});

/** A fresh test repository with its contract and documents, under git, with one commit. */
export function repository(): string {
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
export function references(root: string): { readonly head: string; readonly local: string; readonly remote: string } {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  return { head: git(root, "rev-parse", "HEAD"), local: git(root, "for-each-ref"), remote: git(git(root, "remote", "get-url", "origin"), "for-each-ref") };
}

export interface Setup {
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
  /** Changes the repository once its cards are written, before the run. */
  readonly prepare?: (root: string) => void;
  /** The inbox of the run the cartography is of, when a person may speak to it. */
  readonly inbox?: Inbox;
}

export function configFor(modelUrl: string, setup: Setup = {}): ResolvedConfig {
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
export const ELEMENTS: Readonly<Record<string, readonly string[]>> = {
  "shop-api": ["orders", "customers", "/health"],
  "shop-db": TABLES.map((table) => `public.${table}`),
  "order-specs": ["Orders", "Placing an order"],
  shop: ["/", "/orders"],
};

/** The domain the agent of each source put each of its elements in; an element in none was set aside. */
export const PLACED: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  "shop-api": { orders: ["orders"], customers: ["customers"] },
  "shop-db": { orders: ["public.orders", "public.order_lines"], customers: ["public.customers"] },
  "order-specs": { orders: ["Orders", "Placing an order"] },
  shop: { orders: ["/orders"] },
};

/** The card of a source, as its agent mapped it: its elements in the domains of its own, the others set aside. */
export function cardSubmission(id: string): SourceCardSubmission {
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
export async function writeCards(root: string, config: ResolvedConfig, database: SqlClient, ids: readonly string[]): Promise<void> {
  mkdirSync(join(root, ".oqas", "knowledge", "sources"), { recursive: true });
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
    writeFileSync(join(root, ".oqas", "knowledge", "sources", `${id}.json`), JSON.stringify(card));
  }
}

export const SUBMISSION: KnowledgeBaseSubmission = {
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
export const from = (source: string, domain: string, items?: readonly string[]) => ({ source, domain, ...(items === undefined ? {} : { items }) });

/** What the orchestrator hands in to get `SUBMISSION`: the domains of the sources each domain of the application gathers. */
export const MERGES = {
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
export function gathering(...left: string[]) {
  return { domains: MERGES.domains.map((domain) => ({ ...domain, from: domain.from.filter((part) => !left.includes(part.source)) })) };
}

/** What the orchestrator hands in for a shop whose interface was explored in the run: its home, the one domain of that map, goes with the orders. */
export function explored() {
  const [orders, customers] = gathering("shop").domains;
  return { domains: [{ ...orders!, from: [...orders!.from, from("shop", "all")] }, customers!] };
}

/** The submission without any reference to the sources named. */
export function without(...sources: string[]): KnowledgeBaseSubmission {
  const kept = (references: KnowledgeBaseSubmission["unassigned"]) => references.filter((r) => !sources.includes(r.source));
  return { domains: SUBMISSION.domains.map((domain) => ({ ...domain, references: kept(domain.references) })), unassigned: kept(SUBMISSION.unassigned) };
}

export const submit = (submission: unknown, id = "x1") => ({ id, name: "submit_knowledge_base", arguments: submission });

/** The calls of the agent that explores the shop once it opened its home: the home in a domain, and the orders its link leads to set aside. */
export const HOME_MAPPED = [
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

export interface Run {
  readonly before: ReturnType<typeof references>;
  readonly outcome: CartographyOutcome;
  readonly server: ScriptedServer;
  readonly root: string;
  readonly database: CatalogDouble;
}

/** Runs a cartography against a scripted model, the cards of `setup.cards` already made, then stops the model server. */
export async function cartography(
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
      memory: new KeptMemories(),
      config,
      environment: setup.environment ?? "local",
      repositoryRoot: root,
      env: { SHOP_DB_URL: DB_URL },
      runtime,
      browser: { actionTimeoutMs: 1000, navigationTimeoutMs: 3000, settleTimeoutMs: 0 },
      ...(setup.realDatabase === true ? {} : { sqlClient: () => database }),
      ...(setup.autonomous === true ? {} : { now: () => new Date("2026-11-13T10:00:00.000Z") }),
      ...(setup.observe === undefined ? {} : { observe: setup.observe }),
      ...(setup.inbox === undefined ? {} : { inbox: setup.inbox }),
    });
    return { outcome: await cartographer.run(), server, root, database, before };
  } finally {
    await runtime.close();
    await gateway.close();
    await server.close();
  }
}

export const happy = () => [{ body: toolCalls(MODEL, [submit(MERGES)]) }, { body: answer(MODEL, "Two domains: orders and customers.") }];

export const messages = (outcome: CartographyOutcome) => outcome.journal.map((entry) => entry.message).join("\n");

export const knowledgeBaseFile = (root: string) => join(root, ".oqas", "knowledge", KNOWLEDGE_BASE_FILE_NAME);

/** The fingerprint of the card of a source, as written in the repository: a digest of its JSON content. */
export const cardPrint = (root: string, id: string) =>
  fingerprintOf(JSON.stringify(JSON.parse(readFileSync(join(root, ".oqas", "knowledge", "sources", `${id}.json`), "utf8"))));

export const toolsOffered = (server: ScriptedServer, request: number) =>
  (server.requests[request]!.body as { tools: { function: { name: string } }[] }).tools.map((tool) => tool.function.name);

/** The placement of the tables of the base that gives the card `cardSubmission` describes, and the call that confirms the table set aside. */
export const BASE_ASIDE = { name: "public.schema_migrations", reason: "The log of the migrations." };

export const BASE_PLACEMENTS = [
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
export const mappingTheBase = () => [
  ...BASE_PLACEMENTS.map((call) => ({ body: toolCalls(MODEL, [call]) })),
  { body: answer(MODEL, "Done.") },
  // The file of each of its two domains, then the consolidation.
  { body: answer(MODEL, "The tables `public.orders` and `public.order_lines`.") },
  { body: answer(MODEL, "The table `public.customers`.") },
  ...happy(),
];

/** The lines of the trace of a cartography, each read back from its file. */
export const traceOf = (outcome: CartographyOutcome): TraceLine[] =>
  readFileSync(outcome.tracePath, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as TraceLine);

export const PHASES = ["survey", "card", "consolidation", "knowledge-base"];

/** Whether every phase started, for a source or for the whole run, has its end. */
export const everyStartEnds = (lines: readonly TraceLine[]) => {
  const ends = (type: string) =>
    lines.filter((line) => line.actor === "harness" && line.event.type === type).map((line) => `${line.phase}:${line.source ?? ""}`);
  return JSON.stringify(ends("started").sort()) === JSON.stringify(ends("finished").sort());
};
