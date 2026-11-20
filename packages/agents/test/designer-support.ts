import { withTags } from "../src/designer/scenario-tags.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { CopilotAgentRuntime, ModelGateway, resolveCharter, writerInstructions } from "@open-qa-stack/harness";
import {
  validateConfig,
  type DomainIndex,
  type Language,
  type PlanReview,
  type ProposedTest,
  type ResolvedConfig,
  type ScenarioLevel,
  type SourceCard,
  type TestCheck,
  type TestRunner,
  type TestTrial,
  type TraceLine,
} from "@open-qa-stack/domain";
import { answer, scriptedServer, testSite, toolCalls, type ScriptedServer, type TestSite } from "@open-qa-stack/testing";
import { Designer, readPlanFile, type DesignOutcome, type DesignState, type Inbox, type PlanRecord } from "../src/index.ts";

export const MODEL = "test-model";

export const BRANCH = "oqas/design-test";

export const USERNAME = "ada.brennick@example.com";

export const PASSWORD = "Tr0ub4dor&3";

export const DB_URL = "postgresql://shop:s3cret-db-pass@127.0.0.1:5999/shop";

export const ENV = { SHOP_USERNAME: USERNAME, SHOP_PASSWORD: PASSWORD, SHOP_DB_URL: DB_URL };

// The orders page shows an order once it is searched for.
const ORDERS = `<h1>Orders</h1><input aria-label="Search orders"><button onclick="document.getElementById('found').hidden = false">Search</button><p id="found" hidden>Order 42 of Ada</p>`;

// The pairs page shows two headings nothing tells apart, and two that their regions do.
const PAIRS = `<h2>Open</h2><h2>Open</h2><section aria-label="Late orders"><h3>Due</h3></section><section aria-label="Lost orders"><h3>Due</h3></section>`;

export const site: TestSite = await testSite({ "/": "<h1>Shop</h1>", "/orders": ORDERS, "/pairs": PAIRS });

export const workspace = mkdtempSync(join(tmpdir(), "oqas-designer-"));

afterAll(async () => {
  await site.close();
  rmSync(workspace, { recursive: true, force: true });
});

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

/** The limits of the tasks of a design a test does not set. */
const LIMITS = { maxIterations: 20, maxMinutes: 10, maxActions: 200 };

export function configFor(modelUrl: string, limits = LIMITS): ResolvedConfig {
  const text = JSON.stringify({
    formatVersion: 1,
    applications: [
      {
        id: "shop",
        name: "Shop",
        type: "web-and-api",
        authentication: { method: "form", accounts: [{ name: "demo", usernameEnv: "SHOP_USERNAME", passwordEnv: "SHOP_PASSWORD" }] },
        environments: [
          { name: "local", uiUrl: `${site.origin}/`, apis: [{ name: "shop-backend", baseUrl: "http://127.0.0.1:8090" }] },
          { name: "staging", uiUrl: "http://shop.test" },
        ],
      },
      {
        id: "ledger",
        name: "Ledger",
        type: "api",
        authentication: { method: "none" },
        environments: [{ name: "local", apis: [{ name: "api", baseUrl: "http://ledger.test:8100" }] }],
      },
      { id: "legacy", name: "Legacy", type: "web", authentication: { method: "none" }, environments: [{ name: "staging", uiUrl: "http://legacy.test" }] },
    ],
    knowledge: [
      { id: "shop-api", type: "openapi", path: "contracts/shop.json", attachments: [{ application: "shop" }] },
      { id: "ledger-api", type: "openapi", url: "http://ledger.test:8100/v3/api-docs", attachments: [{ application: "ledger" }] },
      { id: "shop-db", type: "postgresql", connectionStringEnv: "SHOP_DB_URL", attachments: [{ application: "shop" }] },
      { id: "order-specs", type: "document", path: "specs/orders.md", attachments: [{ application: "shop", environment: "local" }] },
      { id: "shop-guide", type: "document", path: "specs/guide.md", attachments: [{ application: "shop" }] },
      { id: "staging-specs", type: "document", path: "specs/staging.md", attachments: [{ application: "shop", environment: "staging" }] },
      { id: "shop-code", type: "source-code", path: "specs", attachments: [{ application: "shop" }] },
    ],
    model: { mode: "provider-key", provider: "openai", baseUrl: modelUrl, model: MODEL },
    autonomy: { level: "bounded", task: limits },
  });
  const result = validateConfig(text, ENV);
  assert.ok(result.ok, JSON.stringify(result));
  return result.config;
}

export const INDEX: DomainIndex = {
  formatVersion: 1,
  producedAt: "2026-11-13T09:00:00.000Z",
  environment: "local",
  model: { provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: MODEL },
  run: { iterations: 1, actions: 0, durationMs: 1 },
  status: "complete",
  sources: [
    { id: "shop-api", type: "openapi", state: "read" },
    { id: "order-specs", type: "document", state: "read" },
    { id: "shop", type: "web", state: "read" },
  ],
  domains: [
    {
      id: "orders",
      label: "Orders",
      description: "Placing and following an order.",
      references: [
        { source: "shop-api", items: ["orders"] },
        { source: "shop", items: ["/orders"] },
      ],
    },
    { id: "customers", label: "Customers", description: "The customers of the shop.", references: [{ source: "shop-api", items: ["customers"] }] },
  ],
  unassigned: [],
};

export const CARD: SourceCard = {
  formatVersion: 1,
  source: { id: "shop-api", type: "openapi" },
  fingerprint: "f",
  producedAt: "2026-11-13T09:00:00.000Z",
  model: INDEX.model,
  run: INDEX.run,
  status: "complete",
  domains: [{ id: "orders", label: "Orders", description: "Orders.", items: [{ name: "orders", summary: "Lists and places the orders of a customer." }] }],
  unassigned: [],
};

/** A test repository under git with one commit, pushed to a local bare remote, and an untracked index. */
export function repository(index: unknown = INDEX, manifest?: string): string {
  const root = mkdtempSync(join(workspace, "repo-"));
  if (manifest !== undefined) writeFileSync(join(root, "package.json"), manifest);
  mkdirSync(join(root, "specs"));
  mkdirSync(join(root, "contracts"));
  writeFileSync(join(root, "specs", "orders.md"), "# Orders\n\nA customer places an order.\n");
  writeFileSync(join(root, "specs", "guide.md"), "# Guide\n");
  writeFileSync(join(root, "specs", "staging.md"), "# Staging\n");
  writeFileSync(join(root, "contracts", "shop.json"), "{}");
  const remote = mkdtempSync(join(workspace, "remote-"));
  git(remote, "init", "-q", "--bare", "-b", "main");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Test Maintainer");
  git(root, "config", "user.email", "maintainer@example.com");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "chore: start the test repository");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-q", "origin", "main");
  mkdirSync(join(root, ".oqas", "index", "sources"), { recursive: true });
  writeFileSync(join(root, ".oqas", "index", "domain-index.json"), typeof index === "string" ? index : JSON.stringify(index));
  writeFileSync(join(root, ".oqas", "index", "sources", "shop-api.json"), JSON.stringify(CARD));
  writeFileSync(join(root, ".oqas", "index", "sources", "order-specs.json"), "{ not json");
  return root;
}

/** The branches and their revisions, the branch checked out, the working tree and the remote's references. */
export function snapshot(root: string): Record<string, string> {
  return {
    branches: git(root, "for-each-ref", "refs/heads"),
    head: git(root, "symbolic-ref", "HEAD"),
    status: git(root, "status", "--porcelain", "--untracked-files=all"),
    diff: git(root, "diff"),
    remote: git(git(root, "remote", "get-url", "origin"), "for-each-ref"),
  };
}

/** The test of a scenario whose one step opens the orders and asserts their heading, as the plan expects; it notes its scenario, which tells its body from the others. */
export const spec = (title: string) =>
  `import { test, expect } from "../../../../shared/fixtures.ts";\n\ntest("${title}", async ({ page }) => {\n  test.info().annotations.push({ type: "scenario", description: "${title}" });\n  await test.step("1. Open the orders", async () => {\n    await page.goto("/orders");\n    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();\n  });\n});\n`;

/** A call of a tool by the model. */
export interface Call {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

/** A scenario of the plan, about the orders of the shop: its one step opens them and expects their heading. */
/** A test as the harness keeps it: with the tags of its scenario, a functional scenario of the orders of the shop unless told otherwise. */
export const tagged = (content: string, kind: "other" | "visual" | "functional" = "other") =>
  withTags(content, { level: "functional", domain: "orders", feature: "listing", application: "shop", kind, case: "nominal", effect: "read" });

export const scenario = (id: string, kind = "other", changes: Record<string, unknown> = {}) => ({
  id,
  title: `The ${id} scenario`,
  intent: `Verifies ${id}.`,
  kind,
  level: "functional",
  effect: "read",
  case: "nominal",
  application: "shop",
  domain: "orders",
  feature: "listing",
  sources: [{ source: "shop", item: "/orders" }],
  data: [{ value: id, from: "made-up" }],
  steps: [{ action: "Open the orders", actions: [1], expects: [{ result: "The orders show", shows: ["Orders"], absent: [] }] }],
  ...changes,
});

/** The scenarios of the plan, in its order. */
export const IDS = ["list-orders", "place-order", "follow-order"];

/** A call that opens the orders page, which the designer looks at before it plans. */
export const OPEN = { id: "open", name: "shop_goto", arguments: { url: "/orders" } };

/** A call that searches the orders, which makes their search result appear. */
export const SEARCH = { id: "search", name: "shop_click", arguments: { target: { role: "button", name: "Search" } } };

/** A call of `propose_plan` with three scenarios about the orders. */
export const PLAN = { id: "plan", name: "propose_plan", arguments: { scenarios: IDS.map((id) => scenario(id)) } };

/** A call of `propose_plan` that adds nothing: the agent says the brief is covered, and the plan is closed. */
export const COVERED = { id: "covered", name: "propose_plan", arguments: { scenarios: [] } };

/** The scenarios of the plan as a design keeps them: each step with the code of the action it cites, each text with its element. */
export const KEPT = IDS.map((id) => ({
  ...scenario(id),
  steps: [
    {
      action: "Open the orders",
      code: ['await page.goto("/orders");'],
      lines: [{ application: "shop", screen: "/orders", code: 'await page.goto("/orders");' }],
      expects: [
        {
          result: "The orders show",
          shows: ["Orders"],
          absent: [],
          elements: [{ text: "Orders", locator: 'page.getByRole("heading", { name: "Orders", exact: true })', field: false }],
        },
      ],
    },
  ],
}));

/** A call of `run_test`. */
export const run = (content: string, id: string): Call => ({ id, name: "run_test", arguments: { content } });

/** A call of `propose_test`, with a diagnosis when one is given. */
export const close = (id: string, diagnosis?: { cause: string; evidence: string }): Call => ({
  id,
  name: "propose_test",
  arguments: diagnosis === undefined ? {} : { diagnosis },
});

/** A turn without a call: the answer that ends a session. */
export const DONE: Call[] = [];

/** The turns of the session of a scenario: its test is run, then closed, each call in a turn of its own, then the agent answers. */
export const write = (name: string, content = spec(name), diagnosis?: { cause: string; evidence: string }): Call[][] => [
  [run(content, `r-${name}`)],
  // A failure held not to be that of the test is confirmed once, by the same call again.
  ...(diagnosis === undefined || diagnosis.cause === "test" ? [] : [[close(`d-${name}`, diagnosis)]]),
  [close(`c-${name}`, diagnosis)],
  DONE,
];

/** The turns that write the tests of the first scenarios of the plan, each passing. */
export const valid = (count: number) => IDS.slice(0, count).flatMap((id) => write(id));

/** The replies that make the calls of each turn, an answer for a turn without a call, then answer enough to end a session and every reminder. */
export const replies = (turns: readonly (readonly Call[])[]) => [
  ...turns.map((calls) => ({ body: calls.length === 0 ? answer(MODEL, "Done.") : toolCalls(MODEL, calls) })),
  ...Array.from({ length: 12 }, () => ({ body: answer(MODEL, "Done.") })),
];

/** A call that looks at the page again, as the agent must between two runs that failed. */
export const look = (id: string): Call => ({ id, name: "shop_snapshot", arguments: {} });

/** A test that fails when it runs. */
export const broken = (title: string) => `${spec(title)}// BROKEN\n`;

/**
 * A runner of the tests that runs nothing: a test fails, with an error, a step and a trace, when its text
 * holds `BROKEN`, and passes otherwise; it remembers each test it was given.
 */
export class FakeTestRunner implements TestRunner {
  public readonly runs: ProposedTest[] = [];
  private readonly error: string | undefined;

  public constructor(error?: string) {
    this.error = error;
  }

  public async run(test: ProposedTest): Promise<TestTrial> {
    this.runs.push(test);
    if (this.error !== undefined) return { startedAt: "2026-11-13T10:00:00.000Z", tests: [], error: this.error };
    const id = `shop › ${test.path} › the test`;
    const broken = test.content.includes("BROKEN");
    const failed = {
      id,
      verdict: "failed" as const,
      reason: "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('heading', { name: 'Orders' })\nExpected: visible\nReceived: hidden",
      failedStep: "open the orders",
      trace: ".oqas/test-results/trace.zip",
    };
    return { startedAt: "2026-11-13T10:00:00.000Z", tests: [broken ? failed : { id, verdict: "passed", reason: "Every attempt passed." }] };
  }
}

export interface Setup {
  readonly runner?: FakeTestRunner;
  readonly root?: string;
  readonly limits?: { maxIterations: number; maxMinutes: number; maxActions: number };
  readonly check?: TestCheck;
  readonly branch?: string | null;
  /** The branch of an earlier design the design goes on with, when it goes on with one. */
  readonly continued?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** The visual tests of the design, when it makes some; none by default here, so that a design is its scenarios alone. */
  readonly visual?: boolean;
  /** How the tests are built, when it is not as the configuration says by default. */
  readonly architecture?: "fixtures" | "standalone";
  /** Whether the plan is submitted before the script; it is by default. */
  readonly plan?: boolean;
  readonly brief?: string;
  /** The domains of the knowledge the plan is kept to. */
  readonly domains?: readonly string[];
  readonly planReview?: PlanReview;
  /** Whether the agent that reviews plans is asked about duplicates. */
  readonly reviewPlan?: boolean;
  readonly reviewTests?: boolean;
  readonly reviewerInstructions?: string;
  readonly reviewCode?: boolean;
  /** The levels the plan is asked for; `default` for those of the designer itself. */
  readonly levels?: readonly ScenarioLevel[] | "default";
  readonly observe?: (line: TraceLine) => void;
  /** The inbox of the run the design is of, when a person may speak to it. */
  readonly inbox?: Inbox;
  /** Whether the configuration declares that the model reads images. */
  readonly vision?: boolean;
  /** The language of the tests, when it is not as the configuration says by default. */
  readonly testLanguage?: Language;
}

export interface Run {
  readonly outcome: DesignOutcome;
  readonly root: string;
  readonly server: ScriptedServer;
  readonly before: Record<string, string>;
}

export async function design(script: readonly { status?: number; body: unknown }[], setup: Setup = {}): Promise<Run> {
  // The designer looks at the orders page, submits its plan, then ends the session that plans, each in a turn of its own, unless the test scripts it.
  const planned = [{ body: toolCalls(MODEL, [OPEN]) }, { body: toolCalls(MODEL, [PLAN]) }, { body: answer(MODEL, "Done.") }];
  const server = await scriptedServer(setup.plan === false ? script : [...planned, ...script]);
  const gateway = await ModelGateway.start({ kind: "live", upstream: { baseUrl: server.baseUrl } });
  const runtime = new CopilotAgentRuntime({ endpoint: gateway, model: MODEL, homeDirectory: mkdtempSync(join(workspace, "home-")) });
  const root = setup.root ?? repository();
  const before = existsSync(join(root, ".git")) || existsSync(join(root, "..", ".git")) ? snapshot(root) : {};
  try {
    const declared = configFor(server.baseUrl, setup.limits);
    const seeing: ResolvedConfig = setup.vision === true ? { ...declared, model: { ...declared.model, capabilities: ["vision"] } } : declared;
    const built: ResolvedConfig = setup.architecture === undefined ? seeing : { ...seeing, design: { ...seeing.design, architecture: setup.architecture } };
    const config: ResolvedConfig = setup.testLanguage === undefined ? built : { ...built, design: { ...built.design, testLanguage: setup.testLanguage } };
    const charter = resolveCharter(config.charter);
    assert.ok(charter.ok);
    const designer = new Designer({
      config,
      repositoryRoot: root,
      env: setup.env ?? ENV,
      runtime,
      writerInstructions: writerInstructions(charter.rules, config.repository),
      browser: { actionTimeoutMs: 1000, navigationTimeoutMs: 3000, settleTimeoutMs: 0 },
      ...(setup.branch === null ? {} : { branch: setup.branch ?? BRANCH, now: () => new Date("2026-11-13T10:00:00.000Z") }),
      ...(setup.continued === undefined ? {} : { continuedBranch: setup.continued }),
      ...(setup.check === undefined ? {} : { check: setup.check }),
      runner: setup.runner ?? new FakeTestRunner(),
      ...(setup.brief === undefined ? {} : { brief: setup.brief }),
      ...(setup.domains === undefined ? {} : { domains: setup.domains }),
      ...(setup.planReview === undefined ? {} : { planReview: setup.planReview }),
      ...(setup.reviewPlan === undefined ? {} : { reviewPlan: setup.reviewPlan }),
      ...(setup.reviewTests === undefined ? {} : { reviewTests: setup.reviewTests }),
      ...(setup.reviewerInstructions === undefined ? {} : { reviewerInstructions: setup.reviewerInstructions }),
      ...(setup.visual === undefined ? {} : { visual: setup.visual }),
      ...(setup.reviewCode === undefined ? {} : { reviewCode: setup.reviewCode }),
      // The scenarios of these tests are functional: the plan is asked for that level alone unless a test says otherwise.
      ...(setup.levels === "default" ? {} : { levels: setup.levels ?? ["functional"] }),
      ...(setup.observe === undefined ? {} : { observe: setup.observe }),
      ...(setup.inbox === undefined ? {} : { inbox: setup.inbox }),
    });
    return { outcome: await designer.run(), root, server, before };
  } finally {
    await runtime.close();
    await gateway.close();
    await server.close();
  }
}

export const messages = (outcome: DesignOutcome) => outcome.journal.map((entry) => entry.message).join("\n");

/** The files of a branch, by path. */
export const filesOf = (root: string, branch = BRANCH) => git(root, "ls-tree", "-r", "--name-only", branch).split("\n");

export const toolsOffered = (server: ScriptedServer) =>
  (server.requests[0]!.body as { tools: { function: { name: string } }[] }).tools.map((tool) => tool.function.name);

export const requestText = (server: ScriptedServer) => JSON.stringify(server.requests[0]!.body);

/** The first request of each session of a design, in order: that of the session that plans, then that of each scenario written. */
export const sessions = (server: ScriptedServer) =>
  server.requests
    .map((request) => request.body as { messages: { role: string; content: string }[]; tools: { function: { name: string; description: string } }[] })
    .filter((body) => body.messages.length === 2);

/** What a session is first asked, without the date the runtime puts before it. */
export const firstMessage = (body: { messages: { content: string }[] }) => body.messages[1]!.content.replace(/^<current_datetime>[^\n]*\n\n/, "");

/** What the session of a scenario is asked, by the rank of the session among those that write. */
export const asked = (server: ScriptedServer, rank: number) =>
  sessions(server)
    .map(firstMessage)
    .filter((message) => message.startsWith("Write "))[rank - 1]!;

/** What ends what the agent is told of a scenario closed. */
export const OVER = "Next: answer with one sentence. Call no more tools.";

/** How a test whose last run passed is classed. */
export const PASSED = [{ at: "2026-11-13T10:00:00.000Z", class: "passed", origin: { by: "harness", check: "run_test" }, reason: "Its last run passed." }];

/** The text of the result of a tool call, as the next request gives it to the model. */
export const toolResult = (server: ScriptedServer, callId: string) => {
  for (const request of server.requests) {
    const found = (request.body as { messages: { role: string; tool_call_id?: string; content?: unknown }[] }).messages.find(
      (message) => message.role === "tool" && message.tool_call_id === callId,
    );
    if (found !== undefined) return JSON.stringify(found.content);
  }
  return "";
};

/** What the agent was told of a tool call: its result, or the error of a refusal. */
export const told = (server: ScriptedServer, callId: string) => {
  const { result } = JSON.parse(JSON.parse(toolResult(server, callId)) as string) as { result: string | { error: string } };
  return typeof result === "string" ? result : result.error;
};

export const stateOf = (outcome: DesignOutcome) => JSON.parse(readFileSync(outcome.statePath!, "utf8")) as DesignState;

/** The plan of a design, as its file records it. */
export const planOf = (outcome: DesignOutcome): PlanRecord => {
  const plan = readPlanFile(readFileSync(outcome.planPath!, "utf8"));
  assert.ok(plan !== undefined, "the file of the plan is read");
  return plan;
};

export const specsOf = (root: string, branch = BRANCH) => filesOf(root, branch).filter((path) => path.endsWith(".spec.ts"));

/** A runner whose tests fail on an action at their first step when their text holds `LOCATOR`, and as the fake one does otherwise. */
export class StepRunner extends FakeTestRunner {
  public override async run(test: ProposedTest): Promise<TestTrial> {
    if (!test.content.includes("LOCATOR")) return super.run(test);
    this.runs.push(test);
    const reason = "TimeoutError: locator.click: Timeout 1000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Search' })";
    return { startedAt: "2026-11-13T10:00:00.000Z", tests: [{ id: `shop › ${test.path} › t`, verdict: "failed", reason, failedStep: "1. Open the orders" }] };
  }
}

/** An index whose customers are described in a section of the guide, and whose guide has that section. */
export const CUSTOMERS: DomainIndex = {
  ...INDEX,
  sources: [...INDEX.sources, { id: "shop-guide", type: "document", state: "read" }],
  domains: [
    INDEX.domains[0]!,
    {
      ...INDEX.domains[1]!,
      references: [
        { source: "shop-api", items: ["customers"] },
        { source: "shop-guide", items: ["Customer search"] },
      ],
    },
  ],
};

/** A test repository whose guide describes the search of a customer. */
export function customersRepository(): string {
  const root = repository(CUSTOMERS);
  writeFileSync(
    join(root, "specs", "guide.md"),
    "# Guide\n\n## Customer search\n\nA clerk finds a customer by the start of their last name; the list shows each match with their city.\n",
  );
  git(root, "commit", "-q", "-am", "docs: describe the search of a customer");
  return root;
}
