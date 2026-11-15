import { withTags } from "../src/designer/scenario-tags.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { CopilotAgentRuntime, ModelGateway, resolveCharter, writerInstructions } from "@open-qa-stack/harness";
import { validateConfig, type DomainIndex, type ResolvedConfig, type SourceCard } from "@open-qa-stack/shared";
import { answer, scriptedServer, testSite, toolCalls, type ScriptedServer, type TestSite } from "@open-qa-stack/testing";
import { moduleSyntax } from "@open-qa-stack/tools";
import type { PlanReview, ProposedTest, ScenarioLevel, TestCheck, TestRunner, TestTrial } from "@open-qa-stack/domain";
import { testPackages } from "../src/designer/spec-rules.ts";
import { Designer, readPlanFile, type DesignOutcome, type DesignState, type PlanRecord } from "../src/index.ts";

const MODEL = "test-model";
const BRANCH = "oqas/design-test";
const USERNAME = "ada.brennick@example.com";
const PASSWORD = "Tr0ub4dor&3";
const DB_URL = "postgresql://shop:s3cret-db-pass@127.0.0.1:5999/shop";
const ENV = { SHOP_USERNAME: USERNAME, SHOP_PASSWORD: PASSWORD, SHOP_DB_URL: DB_URL };

let site: TestSite;
let workspace: string;

before(async () => {
  // The orders page shows an order once it is searched for.
  const orders = `<h1>Orders</h1><input aria-label="Search orders"><button onclick="document.getElementById('found').hidden = false">Search</button><p id="found" hidden>Order 42 of Ada</p>`;
  // The pairs page shows two headings nothing tells apart, and two that their regions do.
  const pairs = `<h2>Open</h2><h2>Open</h2><section aria-label="Late orders"><h3>Due</h3></section><section aria-label="Lost orders"><h3>Due</h3></section>`;
  site = await testSite({ "/": "<h1>Shop</h1>", "/orders": orders, "/pairs": pairs });
  workspace = mkdtempSync(join(tmpdir(), "oqas-designer-"));
});

after(async () => {
  await site.close();
  rmSync(workspace, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function configFor(modelUrl: string, limits = { maxIterations: 20, maxMinutes: 10, maxActions: 200 }): ResolvedConfig {
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

const INDEX: DomainIndex = {
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

const CARD: SourceCard = {
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
function repository(index: unknown = INDEX, manifest?: string): string {
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
function snapshot(root: string): Record<string, string> {
  return {
    branches: git(root, "for-each-ref", "refs/heads"),
    head: git(root, "symbolic-ref", "HEAD"),
    status: git(root, "status", "--porcelain", "--untracked-files=all"),
    diff: git(root, "diff"),
    remote: git(git(root, "remote", "get-url", "origin"), "for-each-ref"),
  };
}

/** The test of a scenario whose one step opens the orders and asserts their heading, as the plan expects; it notes its scenario, which tells its body from the others. */
const spec = (title: string) =>
  `import { test, expect } from "../fixtures.ts";\n\ntest("${title}", async ({ page }) => {\n  test.info().annotations.push({ type: "scenario", description: "${title}" });\n  await test.step("1. Open the orders", async () => {\n    await page.goto("/orders");\n    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();\n  });\n});\n`;

/** A call of a tool by the model. */
interface Call {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

/** A scenario of the plan, about the orders of the shop: its one step opens them and expects their heading. */
/** A test as the harness keeps it: with the tags of its scenario, a functional scenario of the orders of the shop unless told otherwise. */
const tagged = (content: string, kind: "other" | "visual" | "functional" = "other") =>
  withTags(content, { level: "functional", domain: "orders", application: "shop", kind, case: "nominal", effect: "read" });
const scenario = (id: string, kind = "other", changes: Record<string, unknown> = {}) => ({
  id,
  title: `The ${id} scenario`,
  intent: `Verifies ${id}.`,
  kind,
  level: "functional",
  effect: "read",
  case: "nominal",
  application: "shop",
  domain: "orders",
  sources: [{ source: "shop", item: "/orders" }],
  data: [{ value: id, from: "made-up" }],
  steps: [{ action: "Open the orders", actions: [1], expects: [{ result: "The orders show", shows: ["Orders"], absent: [] }] }],
  ...changes,
});
/** The scenarios of the plan, in its order. */
const IDS = ["list-orders", "place-order", "follow-order"];
/** A call that opens the orders page, which the designer looks at before it plans. */
const OPEN = { id: "open", name: "shop_goto", arguments: { url: "/orders" } };
/** A call that searches the orders, which makes their search result appear. */
const SEARCH = { id: "search", name: "shop_click", arguments: { target: { role: "button", name: "Search" } } };
/** A call of `propose_plan` with three scenarios about the orders. */
const PLAN = { id: "plan", name: "propose_plan", arguments: { scenarios: IDS.map((id) => scenario(id)) } };

/** A call of `propose_plan` that adds nothing: the agent says the brief is covered, and the plan is closed. */
const COVERED = { id: "covered", name: "propose_plan", arguments: { scenarios: [] } };

/** The scenarios of the plan as a design keeps them: each step with the code of the action it cites, each text with its element. */
const KEPT = IDS.map((id) => ({
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
const run = (content: string, id: string): Call => ({ id, name: "run_test", arguments: { content } });
/** A call of `propose_test`, with a diagnosis when one is given. */
const close = (id: string, diagnosis?: { cause: string; evidence: string }): Call => ({
  id,
  name: "propose_test",
  arguments: diagnosis === undefined ? {} : { diagnosis },
});
/** A turn without a call: the answer that ends a session. */
const DONE: Call[] = [];
/** The turns of the session of a scenario: its test is run, then closed, each call in a turn of its own, then the agent answers. */
const write = (name: string, content = spec(name), diagnosis?: { cause: string; evidence: string }): Call[][] => [
  [run(content, `r-${name}`)],
  // A failure held not to be that of the test is confirmed once, by the same call again.
  ...(diagnosis === undefined || diagnosis.cause === "test" ? [] : [[close(`d-${name}`, diagnosis)]]),
  [close(`c-${name}`, diagnosis)],
  DONE,
];
/** The turns that write the tests of the first scenarios of the plan, each passing. */
const valid = (count: number) => IDS.slice(0, count).flatMap((id) => write(id));
/** The replies that make the calls of each turn, an answer for a turn without a call, then answer enough to end a session and every reminder. */
const replies = (turns: readonly (readonly Call[])[]) => [
  ...turns.map((calls) => ({ body: calls.length === 0 ? answer(MODEL, "Done.") : toolCalls(MODEL, calls) })),
  ...Array.from({ length: 12 }, () => ({ body: answer(MODEL, "Done.") })),
];
/** A call that looks at the page again, as the agent must between two runs that failed. */
const look = (id: string): Call => ({ id, name: "shop_snapshot", arguments: {} });
/** A test that fails when it runs. */
const broken = (title: string) => `${spec(title)}// BROKEN\n`;

/**
 * A runner of the tests that runs nothing: a test fails, with an error, a step and a trace, when its text
 * holds `BROKEN`, and passes otherwise; it remembers each test it was given.
 */
class FakeTestRunner implements TestRunner {
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

interface Setup {
  readonly runner?: FakeTestRunner;
  readonly root?: string;
  readonly limits?: { maxIterations: number; maxMinutes: number; maxActions: number };
  readonly check?: TestCheck;
  readonly branch?: string | null;
  readonly env?: Readonly<Record<string, string>>;
  /** How the tests are built, when it is not as the configuration says by default. */
  readonly architecture?: "fixtures" | "standalone";
  /** Whether the plan is submitted before the script; it is by default. */
  readonly plan?: boolean;
  readonly brief?: string;
  readonly planReview?: PlanReview;
  /** Whether the agent that reviews plans is asked about duplicates. */
  readonly reviewPlan?: boolean;
  readonly reviewTests?: boolean;
  readonly reviewerInstructions?: string;
  readonly reviewCode?: boolean;
  /** The levels the plan is asked for; `default` for those of the designer itself. */
  readonly levels?: readonly ScenarioLevel[] | "default";
  readonly observe?: (line: { event: { type: string } }) => void;
  readonly resume?: { readonly state: string; readonly branch?: string };
  /** Whether the configuration declares that the model reads images. */
  readonly vision?: boolean;
}

interface Run {
  readonly outcome: DesignOutcome;
  readonly root: string;
  readonly server: ScriptedServer;
  readonly before: Record<string, string>;
}

async function design(script: readonly { status?: number; body: unknown }[], setup: Setup = {}): Promise<Run> {
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
    const config: ResolvedConfig = setup.architecture === undefined ? seeing : { ...seeing, design: { ...seeing.design, architecture: setup.architecture } };
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
      ...(setup.check === undefined ? {} : { check: setup.check }),
      runner: setup.runner ?? new FakeTestRunner(),
      ...(setup.brief === undefined ? {} : { brief: setup.brief }),
      ...(setup.planReview === undefined ? {} : { planReview: setup.planReview }),
      ...(setup.reviewPlan === undefined ? {} : { reviewPlan: setup.reviewPlan }),
      ...(setup.reviewTests === undefined ? {} : { reviewTests: setup.reviewTests }),
      ...(setup.reviewerInstructions === undefined ? {} : { reviewerInstructions: setup.reviewerInstructions }),
      ...(setup.reviewCode === undefined ? {} : { reviewCode: setup.reviewCode }),
      // The scenarios of these tests are functional: the plan is asked for that level alone unless a test says otherwise.
      ...(setup.levels === "default" ? {} : { levels: setup.levels ?? ["functional"] }),
      ...(setup.observe === undefined ? {} : { observe: setup.observe }),
      ...(setup.resume === undefined ? {} : { resume: setup.resume }),
    });
    return { outcome: await designer.run(), root, server, before };
  } finally {
    await runtime.close();
    await gateway.close();
    await server.close();
  }
}

const messages = (outcome: DesignOutcome) => outcome.journal.map((entry) => entry.message).join("\n");
/** The files of a branch, by path. */
const filesOf = (root: string, branch = BRANCH) => git(root, "ls-tree", "-r", "--name-only", branch).split("\n");
const toolsOffered = (server: ScriptedServer) =>
  (server.requests[0]!.body as { tools: { function: { name: string } }[] }).tools.map((tool) => tool.function.name);
const requestText = (server: ScriptedServer) => JSON.stringify(server.requests[0]!.body);
/** The first request of each session of a design, in order: that of the session that plans, unless the design is resumed, then that of each scenario written. */
const sessions = (server: ScriptedServer) =>
  server.requests
    .map((request) => request.body as { messages: { role: string; content: string }[]; tools: { function: { name: string; description: string } }[] })
    .filter((body) => body.messages.length === 2);
/** What a session is first asked, without the date the runtime puts before it. */
const firstMessage = (body: { messages: { content: string }[] }) => body.messages[1]!.content.replace(/^<current_datetime>[^\n]*\n\n/, "");
/** What the session of a scenario is asked, by the rank of the session among those that write. */
const asked = (server: ScriptedServer, rank: number) =>
  sessions(server)
    .map(firstMessage)
    .filter((message) => message.startsWith("Write "))[rank - 1]!;
/** What ends what the agent is told of a scenario closed. */
const OVER = "Next: answer with one sentence. Call no more tools.";
/** How a test whose last run passed is classed. */
const PASSED = [{ at: "2026-11-13T10:00:00.000Z", class: "passed", origin: { by: "harness", check: "run_test" }, reason: "Its last run passed." }];

/** The text of the result of a tool call, as the next request gives it to the model. */
const toolResult = (server: ScriptedServer, callId: string) => {
  for (const request of server.requests) {
    const found = (request.body as { messages: { role: string; tool_call_id?: string; content?: unknown }[] }).messages.find(
      (message) => message.role === "tool" && message.tool_call_id === callId,
    );
    if (found !== undefined) return JSON.stringify(found.content);
  }
  return "";
};
/** What the agent was told of a tool call: its result, or the error of a refusal. */
const told = (server: ScriptedServer, callId: string) => {
  const { result } = JSON.parse(JSON.parse(toolResult(server, callId)) as string) as { result: string | { error: string } };
  return typeof result === "string" ? result : result.error;
};
const stateOf = (outcome: DesignOutcome) => JSON.parse(readFileSync(outcome.statePath!, "utf8")) as DesignState;
/** The plan of a design, as its file records it. */
const planOf = (outcome: DesignOutcome): PlanRecord => {
  const plan = readPlanFile(readFileSync(outcome.planPath!, "utf8"));
  assert.ok(plan !== undefined, "the file of the plan is read");
  return plan;
};
const specsOf = (root: string, branch = BRANCH) => filesOf(root, branch).filter((path) => path.endsWith(".spec.ts"));

describe("criterion 1 — three valid tests are written on a new branch, in the folder of their application, with a state", () => {
  it("writes exactly three spec files and the state that lists them, commits them on the branch, and stays on it", async () => {
    const { outcome, root, server } = await design(replies(valid(3)));
    assert.equal(outcome.ok, true);
    assert.equal(git(root, "branch", "--show-current"), BRANCH);
    assert.deepEqual(specsOf(root), ["apps/shop/follow-order.spec.ts", "apps/shop/list-orders.spec.ts", "apps/shop/place-order.spec.ts"]);
    assert.equal(readFileSync(join(root, "apps", "shop", "list-orders.spec.ts"), "utf8"), tagged(spec("list-orders")));
    // The fixtures the tests import are written for a repository that has none, and committed with them.
    assert.ok(filesOf(root).includes("apps/fixtures.ts"));
    assert.match(readFileSync(join(root, "apps", "fixtures.ts"), "utf8"), /^export const test = base\.extend<Applications>\(\{\n {2}shop: /m);
    // So is the file that gathers the page objects of each application the fixtures give.
    assert.ok(filesOf(root).includes("apps/shop/pages/index.ts"));
    const state = stateOf(outcome);
    assert.equal(outcome.statePath, join(root, ".oqas", "designs", "design-20261113T100000Z.json"));
    assert.equal(outcome.planPath, join(root, ".oqas", "designs", "design-20261113T100000Z.plan.md"));
    for (const file of ["design-20261113T100000Z.json", "design-20261113T100000Z.plan.md"]) assert.ok(filesOf(root).includes(`.oqas/designs/${file}`), file);
    assert.deepEqual(
      state.tests,
      IDS.map((id) => ({ path: `apps/shop/${id}.spec.ts`, scenario: id, verdict: "passed", classes: PASSED, runs: [{ verdict: "passed" }] })),
    );
    assert.deepEqual([state.formatVersion, state.plan, state.brief], [4, ".oqas/designs/design-20261113T100000Z.plan.md", undefined]);
    assert.deepEqual(planOf(outcome), {
      formatVersion: 2,
      design: "design-20261113T100000Z",
      environment: "local",
      scenarios: KEPT,
      // The agent ended its session once the harness asked what was left to cover: the plan was closed with its scenarios.
      ended: "session-end",
    });
    assert.deepEqual(outcome.tests, state.tests);
    assert.deepEqual(
      [state.branch, state.base, state.environment, state.producedAt, state.model.model],
      [BRANCH, git(root, "rev-parse", "main"), "local", "2026-11-13T10:00:00.000Z", MODEL],
    );
    assert.deepEqual(git(root, "log", "-1", "--format=%an <%ae>%n%B", BRANCH).split("\n").slice(0, 4), [
      "Test Maintainer <maintainer@example.com>",
      "test: add 3 generated Playwright tests",
      "",
      "- apps/shop/list-orders.spec.ts: The list-orders scenario",
    ]);
    assert.match(
      messages(outcome),
      /The plan was written to \.oqas\/designs\/design-20261113T100000Z\.plan\.md\.\nThe design state was written to \.oqas\/designs\/design-20261113T100000Z\.json\.\nThe tests were committed on oqas\/design-test; the active branch of the test repository is oqas\/design-test\./,
    );
    assert.equal(git(root, "status", "--porcelain", "--untracked-files=no"), "");
    // The session that plans, then one per scenario: each ends with an answer of the agent.
    assert.equal(server.requests.length, 12);
    assert.deepEqual(
      sessions(server).map((body) => firstMessage(body).split("\n")[0]),
      ["Plan Playwright tests for the environment local.", ...IDS.map(() => "Write the test of this scenario for the environment local.")],
    );
  });

  it("gives the agent the charter, the domains of the index and its tools, the screens, every source of the environment and the notes", async () => {
    const { server } = await design(replies(valid(3)));
    const tools = toolsOffered(server);
    // The session that plans runs no test; that of a scenario submits no plan.
    assert.ok(
      ["shop_goto", "propose_plan", "remember", "recall", "knowledge_domain", "knowledge_list", "knowledge_read"].every((tool) => tools.includes(tool)),
    );
    assert.deepEqual(
      tools.filter((tool) => tool === "run_test" || tool === "propose_test"),
      [],
    );
    const writing = sessions(server)[1]!.tools.map((tool) => tool.function.name);
    // The session of a scenario has the screens of its application, the sources it cites, those that tell why a run failed, and the notes to read.
    assert.ok(["shop_goto", "shop_code_list_files", "run_test", "propose_test", "recall"].every((tool) => writing.includes(tool)));
    // It has the reference of Playwright at the version installed; the session that plans writes no code, and has none.
    assert.deepEqual(
      [writing.filter((tool) => tool.startsWith("playwright_")), tools.filter((tool) => tool.startsWith("playwright_"))],
      [["playwright_search", "playwright_read"], []],
    );
    assert.deepEqual(
      writing.filter((tool) => tool === "propose_plan" || tool === "remember" || /^(index|shop_db|shop_api|order_specs|ledger_api)_/.test(tool)),
      [],
    );
    for (const source of ["order_specs_", "shop_guide_", "shop_api_", "ledger_api_", "shop_db_query"])
      assert.ok(
        tools.some((tool) => tool.startsWith(source)),
        source,
      );
    assert.deepEqual(
      tools.filter((tool) => /^(staging_specs|legacy)_/.test(tool)),
      [],
    );
    const described = new Map(
      (server.requests[0]!.body as { tools: { function: { name: string; description: string } }[] }).tools.map((tool) => [
        tool.function.name,
        tool.function.description,
      ]),
    );
    assert.match(described.get("shop_db_search")!, /Read-only\. A value of the data of a plan comes from a result such as this one\.$/);
    assert.doesNotMatch(described.get("shop_db_query")!, /data of a plan/);
    assert.match(
      described.get("shop_goto")!,
      /Returns what the page shows, the line of code that does the same in a test, and "action", its number: a plan cites it in the steps the action does\.$/,
    );
    assert.match(described.get("propose_plan")!, /in actions the numbers of the browser actions that did it when you explored/);
    assert.match(
      sessions(server)[1]!.tools.find((tool) => tool.function.name === "run_test")!.function.description,
      /^Checks the test of the open scenario against the plan, then runs it/,
    );
    assert.match(described.get("propose_plan")!, /The harness refuses a value or a text no tool showed you\.$/);
    const request = requestText(server);
    for (const fragment of [
      "You plan the tests of the applications of one test environment.",
      "No brief was given",
      "- orders (Orders): Placing and following an order.",
      "- customers (Customers): The customers of the shop.",
      "- shop (Shop, web-and-api): sign in with shop_fill and the account demo.",
      "- ledger (Ledger, api): no sign-in.",
      "Next: call knowledge_domain on the domains above that matter most, read what they hold, do it once on the screens, then call propose_plan.",
    ]) {
      assert.ok(request.includes(JSON.stringify(fragment).slice(1, -1)), fragment);
    }
    assert.ok(!request.includes("Legacy"));
    // The agent that plans is given nothing of the charter nor of what a test may import; the agent that writes is.
    assert.ok(!request.includes("PW-WAIT-01") && !request.includes("A test may import"));
    const written = JSON.stringify(sessions(server)[1]);
    for (const fragment of [
      "You write the Playwright test of one scenario of an accepted plan",
      "PW-WAIT-01",
      "Sign-in: with the account demo; the lines of the sheet that sign in read it from process.env: keep them as they are.",
      "A test may import: apps/fixtures.ts.",
      "Intent: Verifies list-orders.",
      "Cited: shop: /orders.",
    ])
      assert.ok(written.includes(JSON.stringify(fragment).slice(1, -1)), fragment);
    assert.ok(!written.includes("You plan the tests"));
    // The index is looked up, not given whole.
    assert.ok(!request.includes("Lists and places the orders of a customer."));
  });

  it("names the branch after the date by default, ends the file with a new line, and leaves out a state and a plan git ignores", async () => {
    const root = repository();
    writeFileSync(join(root, ".gitignore"), ".oqas/\n");
    git(root, "add", ".gitignore");
    git(root, "commit", "-q", "-m", "chore: ignore the state");
    const { outcome } = await design(replies([...valid(2), ...write("follow-order", spec("follow-order").trimEnd())]), { root, branch: null });
    assert.match(outcome.branch!, /^oqas\/design-\d{8}T\d{6}Z$/);
    assert.equal(readFileSync(join(root, "apps", "shop", "follow-order.spec.ts"), "utf8"), tagged(spec("follow-order")));
    assert.ok(!filesOf(root, outcome.branch).some((path) => path.startsWith(".oqas/")));
    assert.ok(existsSync(outcome.statePath!));
    assert.ok(existsSync(outcome.planPath!));
    assert.match(
      messages(outcome),
      /The plan was written to \.oqas\/designs\/design-\w+\.plan\.md, which git ignores: it was not committed\.\nThe design state was written to \.oqas\/designs\/design-\w+\.json, which git ignores: it was not committed\./,
    );
  });
});

describe("how the tests are built, as the configuration says", () => {
  /** A plan whose first scenario clicks an element of the orders. */
  const clicking = {
    ...PLAN,
    arguments: {
      scenarios: [scenario("list-orders", "other", { steps: [{ action: "Search", actions: [1, 2], expects: [] }] }), ...IDS.slice(1).map((id) => scenario(id))],
    },
  };
  const script = [
    { body: toolCalls(MODEL, [OPEN]) },
    { body: toolCalls(MODEL, [SEARCH]) },
    { body: toolCalls(MODEL, [clicking]) },
    { body: answer(MODEL, "Done.") },
  ];
  const CLICK = 'await page.getByRole("button", { name: "Search", exact: true }).click();';

  it("writes each test on its own, importing Playwright itself, and nothing beside it, for a repository with an architecture of its own", async () => {
    const alone = (id: string) => write(id, spec(id).replace('from "../fixtures.ts"', 'from "@playwright/test"'));
    const { outcome, root, server } = await design([...script, ...replies(IDS.flatMap(alone))], { plan: false, architecture: "standalone" });
    assert.equal(outcome.tests.length, 3, messages(outcome));
    assert.deepEqual(
      filesOf(root).filter((path) => path.startsWith("apps/") && !path.endsWith(".spec.ts")),
      [],
    );
    assert.match(asked(server, 1), /\nA test may import: @playwright\/test\.\n/);
    assert.ok(asked(server, 1).includes(`import { expect, test } from "@playwright/test";`) && asked(server, 1).includes(`    ${CLICK}\n`), asked(server, 1));
  });

  it("gives the tests the fixtures they share and leaves each line on the page, when no page object is asked for", async () => {
    const { outcome, root, server } = await design([...script, ...replies(valid(3))], { plan: false, architecture: "fixtures" });
    assert.equal(outcome.tests.length, 3, messages(outcome));
    assert.ok(filesOf(root).includes("apps/fixtures.ts") && filesOf(root).includes("apps/shop/pages/index.ts"));
    assert.ok(asked(server, 1).includes(`import { expect, test } from "../fixtures.ts";`) && asked(server, 1).includes(`    ${CLICK}\n`), asked(server, 1));
  });
});

describe("criterion 2 — each scenario of a plan gives one test", () => {
  it("writes the four tests of a plan of four scenarios, then refuses any further call", async () => {
    const four = { ...PLAN, arguments: { scenarios: [...IDS, "cancel-order"].map((id) => scenario(id)) } };
    const after = run(spec("late"), "late");
    const { outcome, root, server } = await design(
      [{ body: toolCalls(MODEL, [OPEN]) }, { body: toolCalls(MODEL, [four]) }, ...replies([DONE, ...valid(3), ...write("cancel-order").slice(0, 2), [after]])],
      { plan: false },
    );
    assert.equal(outcome.tests.length, 4);
    assert.equal(specsOf(root).length, 4);
    assert.equal(told(server, "c-cancel-order"), `Scenario cancel-order closed: passed.\n${OVER}`);
    assert.match(
      toolResult(server, "late"),
      /Refused \(SCENARIO-CLOSED\): the scenario of this session is closed\. Answer with one sentence; call no more tools\./,
    );
  });
});

describe("criterion 3 — with two valid tests the design fails, the journal says 2, and both files are on the branch", () => {
  it("reminds the agent, then keeps the two tests, and the skeleton of the third as an unfinished test, and fails", async () => {
    const { outcome, root, server } = await design(replies(valid(2)));
    assert.equal(outcome.ok, false);
    assert.match(messages(outcome), /The design failed: 2 tests were obtained, 3 are expected, one per scenario of the plan\./);
    assert.match(messages(outcome), /The agent stopped before scenario follow-order was closed; it was reminded to go on\./);
    assert.match(
      messages(outcome),
      /The scenario follow-order was closed by the harness \(SESSION-END\): its test is kept as unfinished: apps\/shop\/follow-order\.spec\.ts\./,
    );
    // No test is lost: the scenario the agent left keeps a file, classed as unfinished, which does not count.
    assert.deepEqual(specsOf(root), ["apps/shop/follow-order.spec.ts", "apps/shop/list-orders.spec.ts", "apps/shop/place-order.spec.ts"]);
    assert.match(
      readFileSync(join(root, "apps", "shop", "follow-order.spec.ts"), "utf8"),
      /^import \{ expect, test \} from "\.\.\/fixtures\.ts";\n\ntest\("The follow-order scenario"/,
    );
    assert.deepEqual(stateOf(outcome).tests[2], {
      path: "apps/shop/follow-order.spec.ts",
      scenario: "follow-order",
      verdict: "not_run",
      classes: [
        {
          at: "2026-11-13T10:00:00.000Z",
          class: "unfinished",
          origin: { by: "harness", check: "SESSION-END" },
          reason: "Its session ended before the scenario was closed. Tried: no run; no refusal.",
        },
      ],
      runs: [],
      closedBy: "SESSION-END",
    });
    assert.match(git(root, "log", "-1", "--format=%B", BRANCH), /- apps\/shop\/follow-order\.spec\.ts: unfinished \(SESSION-END\)/);
    const reminder = (server.requests.at(-1)!.body as { messages: { role: string; content: string }[] }).messages
      .filter((message) => message.role === "user")
      .at(-1)!.content;
    assert.match(
      reminder,
      /\nYou stopped before the end\. Scenario 3 of 3, follow-order: its test has not run\.\nNext: check the skeleton of follow-order against its steps, complete what a comment asks, then call run_test with the whole file\./,
    );
  });

  it("reminds an agent that stopped of where the scenario open stands", async () => {
    const done = { body: answer(MODEL, "Done.") };
    const { server } = await design([
      { body: toolCalls(MODEL, [run(spec("list-orders"), "r1")]) },
      done,
      { body: toolCalls(MODEL, [run(broken("list-orders"), "r2")]) },
      done,
      done,
      done,
    ]);
    const reminders = server.requests.flatMap((request) =>
      (request.body as { messages: { role: string; content: string }[] }).messages
        .filter((message) => message.role === "user")
        .slice(1)
        .map((message) => message.content.split("\n\n").at(-1)!),
    );
    assert.deepEqual(
      [...new Set(reminders)],
      [
        "You stopped before the end. Scenario 1 of 3, list-orders: its test passed and is not closed.\nNext: call propose_test.",
        "You stopped before the end. Scenario 1 of 3, list-orders: its last run failed (1 of 3).\nNext: look at the page at the failed step, fix the locator or the wait, then call run_test with the whole corrected file (failed runs: 1 of 3).",
      ],
    );
  });

  it("writes nothing and creates no branch when no test was obtained, the session failing", async () => {
    const { outcome, root, before } = await design([{ status: 500, body: { error: { message: "down" } } }]);
    assert.equal(outcome.ok, false);
    assert.match(messages(outcome), /The session failed: .*\n[^]*No test was written: 0 tests were obtained/);
    assert.deepEqual(snapshot(root).branches, before.branches);
    // The fixtures written for the tests of this design go with them: nothing is left that no commit holds.
    assert.equal(existsSync(join(root, "apps", "fixtures.ts")), false);
    assert.doesNotMatch(git(root, "status", "--porcelain", "--untracked-files=all"), /fixtures/);
  });
});

describe("criterion 4 — a test that imports anything but the fixtures, a declared package or a relative path is not run, and the journal names the module", () => {
  it("refuses a platform package, a computed module, a path outside the repository and another test", async () => {
    const imports = (line: string) => `${line}\n${spec("imports")}`;
    const refused = [
      run(imports(`import { Designer } from "@open-qa-stack/agents";`), "platform"),
      run(imports(`const helper = await import(process.env.HELPER!);`), "computed"),
      run(imports(`import { secret } from "../../../outside.ts";`), "outside"),
      run(imports(`import "./test-1.spec.ts";`), "chained"),
    ];
    const helped = imports(`import { openOrders } from "./helpers/orders.ts";`);
    const runner = new FakeTestRunner();
    const { outcome, root, server } = await design(replies([refused, ...write("list-orders", helped), ...valid(3).slice(2)]), { runner });
    const journal = messages(outcome);
    assert.match(
      journal,
      /\[TEST-IMPORT\] The test apps\/shop\/list-orders\.spec\.ts could not be run: Line 1 imports @open-qa-stack\/agents; import only a relative path inside the test repository\./,
    );
    assert.match(journal, /\[TEST-IMPORT\] .*: Line 1 imports a module whose name is computed/);
    assert.match(journal, /\[TEST-IMPORT\] .*: Line 1 imports \.\.\/\.\.\/\.\.\/outside\.ts, outside the test repository\./);
    assert.match(journal, /\[TEST-IMPORT\] .*: Line 1 imports \.\/test-1\.spec\.ts, another test file/);
    assert.match(told(server, "platform"), /^Refused \(TEST-IMPORT\): Line 1 imports @open-qa-stack\/agents; .*\nNothing else was refused\.$/);
    assert.deepEqual([runner.runs.length, runner.runs[0]!.content], [3, tagged(helped)]);
    assert.equal(readFileSync(join(root, "apps", "shop", "list-orders.spec.ts"), "utf8"), tagged(helped));
  });
});

describe("criterion 5 — a test that does not parse as TypeScript is not run, and the journal holds the parse error", () => {
  it("refuses it with the line and column of the error", async () => {
    const { outcome } = await design(replies([[run(`import { test } from "../fixtures.ts";\ntest("x", async () => {\n`, "parse")], ...valid(3)]));
    assert.match(
      messages(outcome),
      /\[TEST-SYNTAX\] The test apps\/shop\/list-orders\.spec\.ts could not be run: The test does not parse as TypeScript: line \d+, column \d+: (missing|unexpected) /,
    );
    assert.equal(outcome.ok, true);
  });
});

describe("criterion 6 — a test that holds a declared address or the value of an account variable is not run", () => {
  it("refuses an address, a host and a connection string, masks its value in the journal, and lets a test hold the credentials of a test account", async () => {
    const runner = new FakeTestRunner();
    const { outcome, server } = await design(
      replies([
        [
          run(spec("x").replace(`"/orders"`, `"${site.origin}/orders"`), "address"),
          run(spec("x").replace(`"/orders"`, `"//ledger.test:8100/orders"`), "host"),
          run(spec("x").replace(`"/orders"`, `"/orders?db=${encodeURIComponent(DB_URL)}"`), "login"),
          run(`const base = "${DB_URL}";\ntest("x", async () => {\n`, "leaky"),
        ],
        [run(broken("list-orders"), "failing")],
        [close("leaked", { cause: "application", evidence: `It reads ${DB_URL}.` })],
        [look("again")],
        ...valid(3),
      ]),
      { runner },
    );
    const journal = messages(outcome);
    assert.match(journal, new RegExp(`\\[TEST-ADDRESS\\] .*: The test holds ${site.origin.replaceAll(".", "\\.")}, an address of the configuration`));
    assert.match(journal, /\[TEST-ADDRESS\] .*: The test holds ledger\.test:8100, an address of the configuration/);
    assert.match(journal, /\[TEST-SECRET\] .*: The proposal holds the value of SHOP_DB_URL; read it with process\.env\.SHOP_DB_URL instead\./);
    assert.match(
      toolResult(server, "leaked"),
      /Refused \(PROPOSE-SECRET\): the diagnosis holds the value of SHOP_DB_URL\. Leave it out; a test reads it with process\.env\.SHOP_DB_URL\./,
    );
    // A text that holds a secret is refused for it before it is read: nothing of it is quoted.
    assert.doesNotMatch(journal, /TEST-SYNTAX/);
    assert.equal(runner.runs.length, 4);
    const told = server.requests.flatMap((request) =>
      (request.body as { messages: { role: string; content: unknown }[] }).messages.filter((message) => message.role === "tool"),
    );
    const traces = [journal, JSON.stringify(told)].join("\n");
    assert.ok(!traces.includes(DB_URL) && !traces.includes(encodeURIComponent(DB_URL)));
  });

  it("checks only the variables the environment sets", async () => {
    const { outcome } = await design(replies(valid(3)), { env: { SHOP_USERNAME: USERNAME, SHOP_PASSWORD: "" } });
    assert.equal(outcome.ok, true);
  });
});

describe("criterion 7 — a dirty working tree or a taken branch stops the design before anything is written", () => {
  it("stops on a changed tracked file, an untracked file outside the state and the index, and a taken branch, and changes nothing", async () => {
    const root = repository();
    git(root, "branch", BRANCH);
    writeFileSync(join(root, "specs", "orders.md"), "# Orders, changed\n");
    writeFileSync(join(root, "notes.txt"), "draft\n");
    mkdirSync(join(root, ".oqas", "memory"), { recursive: true });
    writeFileSync(join(root, ".oqas", "memory", "notes.jsonl"), "");
    const { outcome, server, before } = await design(replies(valid(3)), { root });
    assert.equal(outcome.ok, false);
    assert.deepEqual(
      outcome.journal.map((entry) => entry.message),
      [
        `The branch ${BRANCH} already exists.`,
        "Tracked files are changed: specs/orders.md.",
        "Untracked files are outside the folders of the state and the index: notes.txt.",
        "No branch was created and no file was written.",
      ],
    );
    assert.deepEqual(snapshot(root), before);
    assert.equal(server.requests.length, 0);
  });

  it("refuses a folder that is not the root of a git repository, and a branch name git refuses", async () => {
    const outside = await design(replies(valid(3)), { root: join(repository(), "specs"), branch: BRANCH });
    assert.match(messages(outside.outcome), /specs is not the root of a git repository with a commit\./);
    const plain = await design(replies(valid(3)), { root: mkdtempSync(join(workspace, "plain-")) });
    assert.match(messages(plain.outcome), /plain-\w+ is not the root of a git repository with a commit\./);
    const root = repository();
    const invalid = await design(replies(valid(3)), { root, branch: "oqas/..bad" });
    assert.match(messages(invalid.outcome), /oqas\/\.\.bad is not a valid branch name\./);
    assert.deepEqual(snapshot(root), invalid.before);
  });

  it("creates the branch when the only untracked files are the index and the state", async () => {
    const root = repository();
    assert.match(git(root, "status", "--porcelain", "--untracked-files=all"), /^\?\? \.oqas\/index\/domain-index\.json/);
    const { outcome } = await design(replies(valid(3)), { root });
    assert.equal(outcome.branch, BRANCH);
  });
});

describe("criterion 8 — the references of the remote are the same before and after the design, whatever its outcome", () => {
  it("contacts no remote when the design succeeds, fails, or stops before the session", async () => {
    for (const turns of [valid(3), valid(1)]) {
      const { root, before } = await design(replies(turns));
      assert.equal(snapshot(root).remote, before.remote);
    }
    const root = repository();
    git(root, "branch", BRANCH);
    const stopped = await design(replies(valid(3)), { root });
    assert.equal(snapshot(root).remote, stopped.before.remote);
  });
});

describe("criterion 9 — past the action limit the task is cut, the journal says so, and the scenario under way is not written", () => {
  it("writes the test closed before the cut, not the one run after the 201st action", async () => {
    const actions = Array.from({ length: 201 }, (_, i) => ({ id: `g${i}`, name: "shop_goto", arguments: { url: "/" } }));
    const { outcome, root } = await design([
      ...valid(1).map((calls) => ({ body: toolCalls(MODEL, calls) })),
      { body: toolCalls(MODEL, [...actions, run(spec("place-order"), "late")]) },
      { body: answer(MODEL, "Done.") },
    ]);
    assert.match(messages(outcome), /The task reached its actions limit; no test was written for the scenario under way\./);
    assert.deepEqual(specsOf(root), ["apps/shop/list-orders.spec.ts"]);
    assert.match(messages(outcome), /The design failed: 1 test was obtained, 3 are expected, one per scenario of the plan\./);
  });
});

describe("criterion 10 — no generated test imports another, and nothing is written in the journeys or the blocks", () => {
  it("holds for three and two tests", async () => {
    for (const count of [3, 2]) {
      const { root } = await design(replies(valid(count)));
      const files = filesOf(root);
      assert.deepEqual(
        files.filter((path) => path.startsWith("parcours/") || path.includes("/blocs/")),
        [],
      );
      for (const path of files.filter((file) => file.endsWith(".spec.ts"))) {
        const syntax = await moduleSyntax(readFileSync(join(root, path), "utf8"));
        assert.ok(syntax.ok);
        assert.deepEqual(
          syntax.imports.map((imported) => imported.module),
          ["../fixtures.ts"],
        );
      }
    }
  });
});

describe("criterion 11 — the designer imports neither the SDK nor a package its package may not depend on", () => {
  it("imports only node modules, its own files and @open-qa-stack/domain, shared and tools", () => {
    const folder = new URL("../src/", import.meta.url);
    const files = readdirSync(folder, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".ts"));
    const imported = files.flatMap((file) =>
      [...readFileSync(new URL(file, folder), "utf8").matchAll(/^(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["'];$|^import\s*["']([^"']+)["'];$/gm)].map(
        (match) => (match[1] ?? match[2])!,
      ),
    );
    const allowed = (module: string) =>
      module.startsWith("node:") || module.startsWith(".") || ["@open-qa-stack/domain", "@open-qa-stack/shared", "@open-qa-stack/tools"].includes(module);
    assert.ok(files.some((file) => file.startsWith("designer")));
    assert.deepEqual(
      imported.filter((module) => !allowed(module)),
      [],
    );
  });
});

describe("guiding the designer", () => {
  it("refuses a test the check finds fault with, each finding with its line, its rule or code, and the example of its rule", async () => {
    const check: TestCheck = {
      check: async (proposed) =>
        proposed.content.includes("waits")
          ? [
              {
                kind: "charter",
                rule: "PW-WAIT-01",
                line: 4,
                column: 9,
                message: "Wait for a state, never for a fixed time.",
                example: 'await expect(page.getByRole("table")).toBeVisible();',
              },
              { kind: "charter", rule: "TEAM-TAG-01", line: 1, column: 1, message: "Tag the test." },
              { kind: "compiler", code: "TS2304", line: 2, column: 1, message: "Cannot find name 'testInfo'." },
            ]
          : [],
    };
    const { outcome, server } = await design(replies([[run(spec("waits"), "waits")], ...valid(3)]), { check });
    assert.equal(
      told(server, "waits"),
      [
        'Refused (TEST-CHECK): Line 4, column 9 (rule PW-WAIT-01): Wait for a state, never for a fixed time. Example: await expect(page.getByRole("table")).toBeVisible();',
        "Refused (TEST-CHECK): Line 1, column 1 (rule TEAM-TAG-01): Tag the test.",
        "Refused (TEST-CHECK): Line 2, column 1 (compiler TS2304): Cannot find name 'testInfo'.",
        "Nothing else was refused.",
      ].join("\n"),
    );
    assert.match(
      messages(outcome),
      /\[TEST-CHECK\] The test apps\/shop\/list-orders\.spec\.ts could not be run: Line 1, column 1 \(rule TEAM-TAG-01\): Tag the test\./,
    );
    assert.equal(outcome.tests.length, 3);
  });

  it("names the test of a scenario after it, with a number when a file of the repository already has that path", async () => {
    const root = repository();
    mkdirSync(join(root, "apps", "shop"), { recursive: true });
    writeFileSync(join(root, "apps", "shop", "list-orders.spec.ts"), "// kept\n");
    writeFileSync(join(root, "apps", "shop", "list-orders-2.spec.ts"), "// kept\n");
    git(root, "add", "-A", "apps");
    git(root, "commit", "-q", "-m", "test: keep a test");
    const { outcome, server } = await design(replies(valid(3)), { root });
    assert.deepEqual(
      outcome.tests.map((test) => test.path),
      ["apps/shop/list-orders-3.spec.ts", "apps/shop/place-order.spec.ts", "apps/shop/follow-order.spec.ts"],
    );
    assert.equal(readFileSync(join(root, "apps", "shop", "list-orders.spec.ts"), "utf8"), "// kept\n");
    assert.match(asked(server, 1), /\nFile: apps\/shop\/list-orders-3\.spec\.ts\n/);
    // The repository had no fixtures of its own: those written are committed with the tests.
    assert.ok(filesOf(root).includes("apps/fixtures.ts"));
  });

  it("designs nothing without a readable index that matches its schema", async () => {
    for (const [index, reason] of [
      ["{", /cannot be read\./],
      [{ ...INDEX, domains: [] }, /does not match its schema: \/domains must NOT have fewer than 1 items\.$/],
    ] as const) {
      const { outcome, server } = await design(replies(valid(3)), { root: repository(index) });
      assert.match(messages(outcome), new RegExp(`^No test was designed: the domain index .*domain-index\\.json ${reason.source}`));
      assert.equal(server.requests.length, 0);
    }
  });
});

describe("the sheet of a scenario", () => {
  it("is what the agent is told once the plan is accepted, and once a scenario is closed: the scenario, its data, its file and its skeleton", async () => {
    const searched = scenario("list-orders", "other", {
      case: "negative",
      data: [
        { value: "Ada", from: "shop" },
        { value: "zzqx", from: "made-up" },
      ],
    });
    const plan = { ...PLAN, arguments: { scenarios: [searched, scenario("place-order"), scenario("follow-order")] } };
    const { server } = await design(
      [{ body: toolCalls(MODEL, [OPEN]) }, { body: toolCalls(MODEL, [SEARCH]) }, { body: toolCalls(MODEL, [plan]) }, ...replies([DONE, ...valid(1)])],
      { plan: false },
    );
    // The session that plans is told its plan is accepted, and that it is over; the sheet goes to the session of the scenario.
    assert.match(told(server, "plan"), /^The plan is not closed yet\. It holds 3 scenarios: list-orders, place-order, follow-order\.\n/);
    const sheet = asked(server, 1);
    assert.ok(
      sheet.startsWith(
        'Write the test of this scenario for the environment local.\n\nSign-in: with the account demo; the lines of the sheet that sign in read it from process.env: keep them as they are.\nA test may import: apps/fixtures.ts.\n\nScenario 1 of 3: list-orders — The list-orders scenario (functional level, other, negative, reads data), application shop.\nIntent: Verifies list-orders.\nData: "Ada" (shop); "zzqx" (made-up).\nCited: shop: /orders.\nFile: apps/shop/list-orders.spec.ts\n\nimport { expect, test } from "../fixtures.ts";\n\ntest("The list-orders scenario", { tag: ["@level-functional","@domain-orders","@app-shop","@kind-other","@case-negative","@data-read"] }, async ({ page }) => {\n  await test.step("1. Open the orders", async () => {\n    await page.goto("/orders");\n    // Expect 1.1: The orders show.\n    await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();\n  });\n});\n',
      ),
      sheet,
    );
    assert.ok(
      sheet.endsWith("Next: check the skeleton of list-orders against its steps, complete what a comment asks, then call run_test with the whole file."),
    );
    assert.equal(told(server, "c-list-orders"), `Scenario list-orders closed: passed.\n${OVER}`);
    assert.match(
      asked(server, 2),
      /\n\nScenario 2 of 3: place-order — .*\nIntent: .*\nData: "place-order" \(made-up\)\.\nCited: .*\nFile: apps\/shop\/place-order\.spec\.ts/,
    );
  });

  it("runs as it is once the agent typed on the screen the invented value it expects: it holds the lines the browser tools returned, and the value in its field", async () => {
    const invented = scenario("list-orders", "other", {
      data: [{ value: "zzqx", from: "made-up" }],
      steps: [{ action: "Search zzqx", actions: [1, 2], expects: [{ result: "The search is echoed", shows: ["Orders", "zzqx"], absent: [] }] }],
    });
    const plan = { ...PLAN, arguments: { scenarios: [invented, scenario("place-order"), scenario("follow-order")] } };
    const sheetOf = (server: ScriptedServer) => asked(server, 1).slice(asked(server, 1).indexOf("import "), asked(server, 1).lastIndexOf("\nNext:"));
    const first = await design([{ body: toolCalls(MODEL, [OPEN]) }, { body: toolCalls(MODEL, [plan]) }, { body: answer(MODEL, "Done.") }], { plan: false });
    assert.match(
      told(first.server, "plan"),
      /Refused \(PLAN-SHOWN\): scenario list-orders, expect 1\.1, names "zzqx", a value of its data that no field of shop held in this session\. Type it with shop_fill/,
    );
    const typed = { id: "type", name: "shop_fill", arguments: { target: { role: "textbox", name: "Search orders" }, value: "zzqx" } };
    const second = await design(
      [{ body: toolCalls(MODEL, [OPEN]) }, { body: toolCalls(MODEL, [typed]) }, { body: toolCalls(MODEL, [plan]) }, { body: answer(MODEL, "Done.") }],
      { plan: false },
    );
    const skeletonText = sheetOf(second.server);
    // The field is typed in through the page object of its screen, which the harness wrote from the plan.
    const line = 'await shop.orders.searchOrdersTextbox.fill("zzqx");';
    assert.ok(
      skeletonText.includes(
        [
          '  await test.step("1. Search zzqx", async () => {',
          '    await page.goto("/orders");',
          `    ${line}`,
          "    // Expect 1.1: The search is echoed.",
          '    await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();',
          '    await expect(page.getByRole("textbox", { name: "Search orders", exact: true })).toHaveValue("zzqx");',
          "  });",
        ].join("\n"),
      ),
      skeletonText,
    );
    // A step emptied of its lines is told them again; the skeleton as it is runs.
    const idle = skeletonText.replace('    await page.goto("/orders");\n', "").replace(`    ${line}\n`, "");
    const { server } = await design(
      [
        { body: toolCalls(MODEL, [OPEN]) },
        { body: toolCalls(MODEL, [typed]) },
        { body: toolCalls(MODEL, [plan]) },
        ...replies([DONE, [run(idle, "idle")], [run(skeletonText, "whole")]]),
      ],
      { plan: false },
    );
    assert.ok(
      told(server, "idle").startsWith(
        'Refused (TEST-ACTION): step 1 does nothing: it must do "Search zzqx" with the code lines of its skeleton, before its assertions, starting with await page.goto("/orders");\n',
      ),
      told(server, "idle"),
    );
    assert.match(told(server, "whole"), /^Run of the file: passed\./);
  });
});

describe("loop, criterion 1 — a test that fails, then is fixed, is run twice and passes", () => {
  it("runs the broken text, then the fixed one, and keeps the test as passed", async () => {
    const runner = new FakeTestRunner();
    const { outcome, server } = await design(replies([[run(broken("list-orders"), "r1")], [look("l1")], ...valid(3)]), { runner });
    assert.deepEqual(
      runner.runs.filter((test) => test.path === "apps/shop/list-orders.spec.ts").map((test) => test.content.includes("BROKEN")),
      [true, false],
    );
    assert.equal(outcome.tests.find((test) => test.path === "apps/shop/list-orders.spec.ts")?.verdict, "passed");
    assert.equal(runner.runs.length, 4, "a scenario is closed with the text of its last run, which is not run again");
    assert.match(
      messages(outcome),
      // The look the repair needs is journaled as one beyond the sheet, after the failed run, and counted once the session is over.
      /The test apps\/shop\/list-orders\.spec\.ts was run: failed\.\n\[SHEET-BEYOND\] Scenario list-orders, after failed run 1: shop_snapshot\.\nThe test apps\/shop\/list-orders\.spec\.ts was run: passed\.\n.*\nScenario list-orders: 1 calls beyond its sheet\.\n/,
    );
    assert.match(
      told(server, "r-list-orders"),
      /^Run of the file: passed\.\n- shop › apps\/shop\/list-orders\.spec\.ts › the test: passed\.\nNext: call propose_test\.$/,
    );
  });
});

describe("loop, criterion 2 — the result told to the agent holds the assertion, the failed step and the trace", () => {
  it("gives the error in full, the step, the trace and the instant to read the logs from", async () => {
    const { server } = await design(replies([[run(broken("list-orders"), "r1")], [look("l1")], ...valid(3)]));
    const told = toolResult(server, "r1");
    for (const part of [
      "Run of the file: failed.",
      "expect(locator).toBeVisible() failed",
      "getByRole('heading', { name: 'Orders' })",
      "Failed step: open the orders",
      "Trace: .oqas/test-results/trace.zip",
      "since 2026-11-13T10:00:00.000Z",
      "Next: look at the page at the failed step",
    ])
      assert.ok(told.includes(part), part);
  });

  it("refuses to run a test the rules refuse, and tells why when a test cannot run", async () => {
    const runner = new FakeTestRunner();
    const { server } = await design(replies([[run(`import fs from "node:fs";\n${spec("list-orders")}`, "r1")], ...valid(3)]), { runner });
    assert.match(toolResult(server, "r1"), /Refused \(TEST-IMPORT\): Line 1 imports node:fs/);
    assert.ok(runner.runs.every((test) => !test.content.includes("node:fs")));
    const failing = new FakeTestRunner("The browsers of Playwright 1.64.1 could not be installed: offline");
    const cannot = await design(replies(valid(1)), { runner: failing });
    assert.match(
      toolResult(cannot.server, "r-list-orders"),
      /Run of the file: it could not run: The browsers of Playwright 1\.64\.1 could not be installed: offline/,
    );
    assert.match(toolResult(cannot.server, "c-list-orders"), /Refused \(PROPOSE-RUN\): scenario list-orders has not run to a verdict\. Call run_test first\./);
    // The test that could not run is not lost: it is kept as unfinished, with what was tried.
    assert.deepEqual(
      [cannot.outcome.tests[0]!.verdict, cannot.outcome.tests[0]!.classes[0]!.class, cannot.outcome.tests[0]!.classes[0]!.reason],
      ["not_run", "unfinished", "Its session ended before the scenario was closed. Tried: 1 run (no verdict); refusals: PROPOSE-RUN ×1."],
    );
    assert.match(messages(cannot.outcome), /The test apps\/shop\/list-orders\.spec\.ts could not run: The browsers/);
  });
});

describe("loop, criterion 3 — the runs count against the limits, and a test not fixed is never kept as passed", () => {
  it("stops at the limit of iterations, and keeps no test that did not pass", async () => {
    const trials = Array.from({ length: 6 }, (_, i) => ({ body: toolCalls(MODEL, [run(`${broken("list-orders")}// ${i}\n`, `r${i}`)]) }));
    const { outcome } = await design([...trials, { body: answer(MODEL, "Done.") }], { limits: { maxIterations: 3, maxMinutes: 10, maxActions: 200 } });
    assert.match(messages(outcome), /The task reached its iterations limit/);
    assert.deepEqual(outcome.tests, []);
    assert.equal(outcome.ok, false);
  });

  it("refuses to close a scenario whose last run failed without a diagnosis, and one that has not run", async () => {
    const { outcome, server } = await design(replies([[close("early")], [run(broken("list-orders"), "r1")], [close("blind")], [look("l1")], ...valid(3)]));
    assert.match(toolResult(server, "early"), /Refused \(PROPOSE-RUN\): scenario list-orders has not run\. Call run_test first\./);
    assert.match(
      toolResult(server, "blind"),
      /Refused \(PROPOSE-DIAG\): the last run of scenario list-orders failed\. Repair it with run_test \(failed runs: 1 of 3\), or give diagnosis: the cause and what the run showed\./,
    );
    assert.match(messages(outcome), /\[PROPOSE-DIAG\] The scenario list-orders could not be closed: the last run/);
    assert.ok(outcome.tests.every((test) => test.verdict === "passed"));
  });
});

describe("loop, criterion 4 — a failing test is kept with its diagnosis and the harness's verdict", () => {
  it("writes the test with its verdict failed and its quarantine in the state, and counts it only when the application is at fault", async () => {
    const blamed = write("follow-order", broken("follow-order"), { cause: "application", evidence: "The total stays empty although the order has two lines." });
    const { outcome, root, server } = await design(replies([...valid(2), ...blamed]));
    assert.equal(outcome.ok, true, messages(outcome));
    const test = stateOf(outcome).tests.find((candidate) => candidate.scenario === "follow-order");
    assert.deepEqual(test, {
      path: "apps/shop/follow-order.spec.ts",
      scenario: "follow-order",
      verdict: "failed",
      classes: [
        {
          at: "2026-11-13T10:00:00.000Z",
          class: "failing-application",
          origin: { by: "agent", role: "writer" },
          reason: "The total stays empty although the order has two lines.",
        },
      ],
      runs: [{ verdict: "failed", errorClass: "assertion", failedStep: "open the orders" }],
      quarantine: {
        cause: "application",
        evidence: "The total stays empty although the order has two lines.",
        failedStep: "open the orders",
        errorClass: "assertion",
      },
    });
    assert.equal(readFileSync(join(root, "apps", "shop", "follow-order.spec.ts"), "utf8"), tagged(broken("follow-order")));
    assert.match(git(root, "log", "-1", "--format=%B", BRANCH), /- apps\/shop\/follow-order\.spec\.ts: failing \(application\)/);
    assert.equal(told(server, "c-follow-order"), `Scenario follow-order closed: failing (application), kept for a person to decide.\n${OVER}`);
    const own = await design(
      replies([...valid(2), ...write("follow-order", broken("follow-order"), { cause: "plan", evidence: "The heading of the plan is wrong." })]),
    );
    assert.equal(own.outcome.ok, false);
    assert.equal(own.outcome.tests.length, 3);
    assert.match(messages(own.outcome), /The design failed: 2 tests were obtained/);
  });
});

/** A runner whose tests fail on an action at their first step when their text holds `LOCATOR`, and as the fake one does otherwise. */
class StepRunner extends FakeTestRunner {
  public override async run(test: ProposedTest): Promise<TestTrial> {
    if (!test.content.includes("LOCATOR")) return super.run(test);
    this.runs.push(test);
    const reason = "TimeoutError: locator.click: Timeout 1000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Search' })";
    return { startedAt: "2026-11-13T10:00:00.000Z", tests: [{ id: `shop › ${test.path} › t`, verdict: "failed", reason, failedStep: "1. Open the orders" }] };
  }
}

describe("the repair contract", () => {
  it("asks for a look between two failed runs, refuses a text that already failed, and stops a scenario at its third failed run", async () => {
    const failing = (marker: string) => `${broken("list-orders")}// ${marker}\n`;
    const runner = new StepRunner();
    const turns = [
      [run(failing("1"), "f1")],
      [run(failing("2"), "blind")],
      [look("l1")],
      [run(failing("1"), "same")],
      [close("early", { cause: "test", evidence: "The heading never shows." })],
      [run(failing("2"), "f2")],
      [look("l2")],
      [run(`${failing("3")}// LOCATOR\n`, "f3")],
      [close("cause", { cause: "application", evidence: "The search does nothing." })],
      [look("l3")],
      [run(failing("4"), "stop")],
      [close("kept", { cause: "test", evidence: "The search button cannot be reached." })],
      ...valid(3).slice(2),
    ];
    const { outcome, root, server } = await design(replies(turns), { runner });
    assert.match(
      told(server, "f1"),
      /\nThe application shows hidden where the plan expects visible\. The expected text stays\. .*\nFailed runs of list-orders: 1 of 3\.\nNext: look at the page at the failed step, fix the locator or the wait, then call run_test with the whole corrected file \(failed runs: 1 of 3\)\.$/,
    );
    assert.equal(
      told(server, "blind"),
      'Refused (TEST-LOOK): look before you run again. Take shop_snapshot at the step that failed ("open the orders").\nNothing else was refused.',
    );
    assert.equal(
      told(server, "same"),
      "Refused (TEST-SAME): this text already failed, and nothing changed. Fix the locator or the wait the error names, or call propose_test with diagnosis.\nNothing else was refused.",
    );
    assert.match(told(server, "early"), /^Refused \(PROPOSE-EARLY\): failed runs: 1 of 3\. Try a repair with run_test before giving up on the test itself\.\n/);
    assert.match(
      told(server, "f3"),
      /\nThe element is not on the screen at that step\. .*\nFailed runs of list-orders: 3 of 3\.\nNext: call propose_test with diagnosis\.$/,
    );
    assert.match(
      told(server, "cause"),
      /^Refused \(PROPOSE-CAUSE\): cause "application" does not fit: the run failed on locator at step "1\. Open the orders", before any check of the application\. Fix the locator, or give cause "test"\.\n/,
    );
    assert.match(told(server, "stop"), /^Refused \(TEST-STOP\): scenario list-orders failed 3 runs\. Do not run it again\. Call propose_test with diagnosis/);
    assert.match(told(server, "kept"), /^Scenario list-orders closed: failing \(test\), kept for a person to decide\./);
    assert.equal(runner.runs.filter((test) => test.path === "apps/shop/list-orders.spec.ts").length, 3);
    const kept = stateOf(outcome).tests[0]!;
    assert.deepEqual(
      [kept.runs, kept.quarantine],
      [
        [
          { verdict: "failed", errorClass: "assertion", failedStep: "open the orders" },
          { verdict: "failed", errorClass: "assertion", failedStep: "open the orders" },
          { verdict: "failed", errorClass: "locator", failedStep: "1. Open the orders" },
        ],
        { cause: "test", evidence: "The search button cannot be reached.", failedStep: "1. Open the orders", errorClass: "locator" },
      ],
    );
    assert.match(git(root, "log", "-1", "--format=%B", BRANCH), /- apps\/shop\/list-orders\.spec\.ts: failing \(test\) at step 1\n/);
    assert.match(messages(outcome), /\[TEST-LOOK\] The test apps\/shop\/list-orders\.spec\.ts could not be run: look before you run again/);
  });

  it("keeps as unfinished the test of a scenario whose three runs gave no verdict, and counts a read of the code as a look", async () => {
    const offline = new FakeTestRunner("The browsers of Playwright could not be installed: offline");
    const passing = new FakeTestRunner();
    const runner: TestRunner = { run: async (test) => (test.path.endsWith("list-orders.spec.ts") ? offline : passing).run(test) };
    const code = (id: string): Call => ({ id, name: "shop_code_list_files", arguments: {} });
    const turns = [
      [run(spec("a"), "n1")],
      [code("c1")],
      [run(spec("b"), "n2")],
      [look("l1")],
      [run(spec("c"), "n3")],
      [close("gone")],
      DONE,
      ...valid(3).slice(3),
    ];
    const { outcome, root, server } = await design(replies(turns), { runner: runner as FakeTestRunner });
    assert.match(told(server, "n2"), /^Run of the file: it could not run: .*offline\nFailed runs of list-orders: 2 of 3\./);
    assert.equal(told(server, "gone"), `Scenario list-orders closed, its test kept as unfinished: none of its runs gave a verdict.\n${OVER}`);
    assert.match(
      messages(outcome),
      /The scenario list-orders was closed by the harness \(TEST-STOP\): its test is kept as unfinished: apps\/shop\/list-orders\.spec\.ts\./,
    );
    const [unfinished] = stateOf(outcome).tests;
    assert.deepEqual(
      [offline.runs.length, outcome.tests.map((test) => test.scenario), unfinished!.verdict, unfinished!.closedBy, unfinished!.classes],
      [
        3,
        IDS,
        "not_run",
        "TEST-STOP",
        [
          {
            at: "2026-11-13T10:00:00.000Z",
            class: "unfinished",
            origin: { by: "harness", check: "TEST-STOP" },
            reason: "None of its 3 runs gave a verdict. Tried: 3 runs (no verdict, no verdict, no verdict); no refusal.",
          },
        ],
      ],
    );
    // The file kept is the last one submitted.
    assert.equal(readFileSync(join(root, "apps", "shop", "list-orders.spec.ts"), "utf8"), tagged(spec("c")));
  });

  it("keeps a test failing on another error than an assertion only as the test's fault, with every run, even one that gave no verdict", async () => {
    const runner: TestRunner = {
      run: async (test) =>
        test.content.includes("OFFLINE")
          ? { startedAt: "2026-11-13T10:00:00.000Z", tests: [], error: "offline" }
          : {
              startedAt: "2026-11-13T10:00:00.000Z",
              tests: [{ id: `shop › ${test.path} › t`, verdict: "failed", reason: "ReferenceError: total is not defined" }],
            },
    };
    const text = (marker: string) => `${spec("list-orders")}// ${marker}\n`;
    const turns = [
      [run(text("OFFLINE"), "r0")],
      [look("l0")],
      [run(text("1"), "r1")],
      [close("cause", { cause: "application", evidence: "The total is wrong." })],
      [run(text("2"), "blind")],
      [look("l1")],
      [run(text("3"), "r3")],
      [close("kept", { cause: "test", evidence: "The total cannot be read." })],
    ];
    const { outcome, root, server } = await design(replies(turns), { runner: runner as FakeTestRunner });
    assert.match(
      told(server, "cause"),
      /^Refused \(PROPOSE-CAUSE\): cause "application" does not fit: the run failed on other, before any check of the application\./,
    );
    assert.match(told(server, "blind"), /^Refused \(TEST-LOOK\): look before you run again\. Take shop_snapshot at the step that failed\.\n/);
    const kept = stateOf(outcome).tests[0]!;
    assert.deepEqual(
      [kept.runs, kept.quarantine],
      [
        [{}, { verdict: "failed", errorClass: "other" }, { verdict: "failed", errorClass: "other" }],
        { cause: "test", evidence: "The total cannot be read.", errorClass: "other" },
      ],
    );
    assert.match(git(root, "log", "-1", "--format=%B", BRANCH), /- apps\/shop\/list-orders\.spec\.ts: failing \(test\)$/m);
  });

  it("tells a look at an application without a user interface by the tools of its sources, any of which counts", async () => {
    const cited = { application: "ledger", sources: [{ source: "shop-guide" }] };
    const ledger = { ...PLAN, arguments: { scenarios: IDS.map((id) => scenario(id, "other", cited)) } };
    const contract: Call = { id: "contract", name: "shop_guide_list_sections", arguments: {} };
    const turns = [
      [OPEN, { ...contract, id: "read" }],
      [ledger],
      DONE,
      [run(broken("list-orders"), "f1")],
      [run(`${broken("list-orders")}// 2\n`, "blind")],
      [contract],
      [run(`${broken("list-orders")}// 3\n`, "f2")],
    ];
    const { server } = await design(replies(turns), { plan: false });
    assert.equal(
      told(server, "blind"),
      'Refused (TEST-LOOK): look before you run again. Read the source code with shop_code_list_files, at the step that failed ("open the orders").\nNothing else was refused.',
    );
    assert.match(told(server, "f2"), /^Run of the file: failed\./);
  });

  it("counts a call of any browser tool of the application as a look", async () => {
    const console: Call = { id: "console", name: "shop_console", arguments: {} };
    const { server } = await design(replies([[run(broken("list-orders"), "f1")], [console], [run(`${broken("list-orders")}// 2\n`, "f2")]]));
    assert.match(told(server, "f2"), /^Run of the file: failed\./);
  });

  it("runs the calls of one turn one after the other, each seeing the run the previous recorded", async () => {
    const runner = new FakeTestRunner();
    const failing = (marker: string) => `${broken("list-orders")}// ${marker}\n`;
    const { outcome, server } = await design(
      replies([[run(failing("1"), "f1")], [look("l1")], [run(failing("2"), "f2")], [look("l2")], [run(failing("3"), "t1"), run(failing("3"), "t2")]]),
      { runner },
    );
    assert.match(told(server, "t1"), /\nFailed runs of list-orders: 3 of 3\.\n/);
    assert.match(told(server, "t2"), /^Refused \(TEST-STOP\): .*\nRefused \(TEST-SAME\): .*\nRefused \(TEST-LOOK\): /);
    assert.equal(runner.runs.length, 3);
    assert.match(messages(outcome), /\[TEST-SAME\] The test apps\/shop\/list-orders\.spec\.ts could not be run/);
  });

  it("keeps the last run that gave a verdict when the last of all gave none", async () => {
    const runner: TestRunner = {
      run: async (test) =>
        test.content.includes("OFFLINE") ? { startedAt: "2026-11-13T10:00:00.000Z", tests: [], error: "offline" } : new FakeTestRunner().run(test),
    };
    const failing = (marker: string) => `${broken("list-orders")}// ${marker}\n`;
    const turns = [
      [run(failing("1"), "f1")],
      [look("l1")],
      [run(failing("2"), "f2")],
      [look("l2")],
      [run(failing("OFFLINE"), "f3")],
      [close("kept", { cause: "application", evidence: "The heading never shows." })],
    ];
    const { outcome, root, server } = await design(replies(turns), { runner: runner as FakeTestRunner });
    assert.match(told(server, "kept"), /^Scenario list-orders closed: failing \(application\), kept for a person to decide\./);
    const kept = stateOf(outcome).tests[0]!;
    assert.deepEqual([kept.runs.length, kept.quarantine?.cause], [3, "application"]);
    assert.equal(readFileSync(join(root, "apps", "shop", "list-orders.spec.ts"), "utf8"), tagged(failing("2")));
  });
});

describe("refusals for the same reason", () => {
  it("give what the gate would accept from the third, start again after a run, and close the scenario at the fifth", async () => {
    const flat = (marker: string) => `import { test } from "../fixtures.ts";\n\ntest("list", async () => {});\n// ${marker}\n`;
    const turns = [
      ...["1", "2", "3"].map((marker) => [run(flat(marker), `s${marker}`)]),
      [run(broken("list-orders"), "ran")],
      [look("l1")],
      ...["4", "5", "6", "7", "8"].map((marker) => [run(flat(marker), `s${marker}`)]),
      DONE,
      ...["1", "2", "3", "4", "5"].map((marker) => [run(flat(marker), `p${marker}`)]),
      DONE,
      ...valid(3).slice(6),
    ];
    const { outcome, root, server } = await design(replies(turns));
    assert.match(told(server, "s2"), /^Refused \(TEST-STEPS\): .*\nRefused \(TEST-VALUE\): .*\nNothing else was refused\.$/);
    const sheet = asked(server, 1);
    const skeletonText = sheet.slice(sheet.indexOf("import "), sheet.lastIndexOf("\nNext:"));
    assert.equal(told(server, "s3"), `Third refusal for the same reason. Do this:\n${skeletonText}`);
    // A run starts the count again.
    assert.match(told(server, "s5"), /^Refused \(TEST-STEPS\): /);
    assert.match(told(server, "s7"), /^Fourth refusal for the same reason\. Do this:\nimport /);
    // The test that ran to a verdict before the refusals is kept as it ended.
    assert.equal(
      told(server, "s8"),
      `Scenario list-orders was closed by the harness after 5 refusals for TEST-STEPS, with the test of its last run: failing (test), kept for a person to decide.\n${OVER}`,
    );
    assert.match(
      messages(outcome),
      /The scenario list-orders was closed by the harness after 5 refusals for TEST-STEPS; the test of its last run that gave a verdict is kept, failing \(test\), kept for a person to decide: apps\/shop\/list-orders\.spec\.ts\./,
    );
    // A scenario whose test never ran keeps the last text submitted, as unfinished.
    assert.equal(
      told(server, "p5"),
      `Scenario place-order was closed by the harness after 5 refusals for TEST-STEPS; its test is kept as unfinished.\n${OVER}`,
    );
    assert.match(
      messages(outcome),
      /The scenario place-order was closed by the harness \(TEST-STEPS\): its test is kept as unfinished: apps\/shop\/place-order\.spec\.ts\./,
    );
    const state = stateOf(outcome);
    assert.deepEqual(
      [outcome.ok, specsOf(root), state.tests.map((test) => test.classes.at(-1)!.class), state.tests[1]!.closedBy],
      [
        false,
        ["apps/shop/follow-order.spec.ts", "apps/shop/list-orders.spec.ts", "apps/shop/place-order.spec.ts"],
        ["failing-test", "unfinished", "passed"],
        "TEST-STEPS",
      ],
    );
    assert.equal(readFileSync(join(root, "apps", "shop", "place-order.spec.ts"), "utf8"), tagged(flat("5")));
    assert.deepEqual(state.tests[0]!.classes, [
      {
        at: "2026-11-13T10:00:00.000Z",
        class: "failing-test",
        origin: { by: "harness", check: "TEST-STEPS" },
        reason: "The scenario was closed by the harness after 5 refusals for TEST-STEPS.",
      },
    ]);
    assert.deepEqual(
      [state.tests[0]!.closedBy, state.tests[0]!.quarantine],
      [
        "TEST-STEPS",
        { cause: "test", evidence: "closed by the harness after 5 refusals for TEST-STEPS", failedStep: "open the orders", errorClass: "assertion" },
      ],
    );
    assert.equal(readFileSync(join(root, "apps", "shop", "list-orders.spec.ts"), "utf8"), tagged(broken("list-orders")));
  });

  it("keep a failing test whose closing the agent kept asking for the wrong way, as failing, for the code refused", async () => {
    const failing = (marker: string) => `${broken("list-orders")}// ${marker}\n`;
    const runner = new StepRunner();
    const runs = [[run(failing("1"), "f1")], [look("l1")], [run(failing("2"), "f2")], [look("l2")], [run(failing("3"), "f3")]];
    const again = ["1", "2", "3", "4", "5"].map((marker) => [run(failing(`again ${marker}`), `a${marker}`)]);
    const stopped = await design(replies([...runs, ...again]), { runner });
    assert.match(
      told(stopped.server, "a5"),
      /^Scenario list-orders was closed by the harness after 5 refusals for TEST-STOP, with the test of its last run: failing \(test\), kept for a person to decide\./,
    );
    const kept = stateOf(stopped.outcome).tests[0]!;
    assert.deepEqual(
      [kept.verdict, kept.closedBy, kept.quarantine?.evidence, kept.runs.length, runner.runs.length],
      ["failed", "TEST-STOP", "closed by the harness after 5 refusals for TEST-STOP", 3, 3],
    );
    const blamed = ["1", "2", "3", "4", "5"].map((marker) => [close(`b${marker}`, { cause: "application", evidence: "The search does nothing." })]);
    const located = await design(replies([[run(`${failing("1")}// LOCATOR\n`, "f1")], ...blamed]), { runner: new StepRunner() });
    assert.match(
      told(located.server, "b5"),
      /^Scenario list-orders was closed by the harness after 5 refusals for PROPOSE-CAUSE, with the test of its last run: failing \(test\)/,
    );
    assert.deepEqual(
      stateOf(located.outcome)
        .tests.slice(0, 1)
        .map((test) => [test.closedBy, test.quarantine?.errorClass]),
      [["PROPOSE-CAUSE", "locator"]],
    );
  });
});

describe("what a run tells the agent", () => {
  it("cuts a long error, and counts a file whose run gives no test as not run", async () => {
    const long: TestRunner = {
      run: async (test) => ({ startedAt: "2026-11-13T10:00:00.000Z", tests: [{ id: `shop › ${test.path} › t`, verdict: "failed", reason: "x".repeat(5000) }] }),
    };
    const cut = await design(replies(valid(1)), { runner: long as FakeTestRunner });
    const told = toolResult(cut.server, "r-list-orders");
    assert.ok(told.includes(`${"x".repeat(1500)}…`) && !told.includes("x".repeat(1501)) && !told.includes("Failed step"));
    const empty: TestRunner = { run: async () => ({ startedAt: "2026-11-13T10:00:00.000Z", tests: [] }) };
    const none = await design(replies(valid(1)), { runner: empty as FakeTestRunner });
    assert.match(toolResult(none.server, "r-list-orders"), /Run of the file: not_run\./);
    assert.deepEqual([none.outcome.tests[0]!.verdict, none.outcome.tests[0]!.classes[0]!.class], ["not_run", "unfinished"]);
  });
});

describe("what the designer may keep", () => {
  it("keeps a passing test as passed whatever the diagnosis claims", async () => {
    const { outcome } = await design(
      replies([...valid(2), ...write("follow-order", spec("follow-order"), { cause: "application", evidence: "The service returns no total." })]),
    );
    const kept = outcome.tests.find((test) => test.scenario === "follow-order");
    assert.deepEqual([kept?.verdict, kept !== undefined && "quarantine" in kept], ["passed", false]);
  });

  it("never keeps a test that did not run to a verdict, even with a diagnosis", async () => {
    for (const verdict of ["skipped", "blocked"] as const) {
      const runner: TestRunner = {
        run: async (test) => ({ startedAt: "2026-11-13T10:00:00.000Z", tests: [{ id: `shop › ${test.path} › t`, verdict, reason: "x" }] }),
      };
      const { outcome, server } = await design(
        replies(write("list-orders", spec("list-orders"), { cause: "application", evidence: "The application is down." })),
        { runner: runner as FakeTestRunner },
      );
      // A test whose run gave no verdict is kept as unfinished, never as passed nor as failing by a diagnosis.
      assert.deepEqual(
        outcome.tests.map((test) => [test.verdict, test.classes[0]!.class, "quarantine" in test]),
        IDS.map(() => ["not_run", "unfinished", false]),
        verdict,
      );
      assert.match(toolResult(server, "c-list-orders"), /Refused \(PROPOSE-RUN\): scenario list-orders has not run to a verdict/);
    }
  });

  it("refuses a test that writes a file, without running it", async () => {
    const runner = new FakeTestRunner();
    const writes = spec("list-orders").replace("  });\n", '    await page.screenshot({ path: "/tmp/x.png" });\n  });\n');
    const { outcome } = await design(replies([[run(writes, "r1")], ...valid(3)]), { runner });
    assert.match(messages(outcome), /\[TEST-FILE\] The test apps\/shop\/list-orders\.spec\.ts could not be run: The test writes a file/);
    assert.ok(runner.runs.every((test) => !test.content.includes("screenshot")));
  });
});

describe("a visual test", () => {
  it("is run and kept: it opens a page and compares a full capture with its reference", async () => {
    const runner = new FakeTestRunner();
    const visual = `import { test, expect } from "../fixtures.ts";\n\ntest("the list of orders looks as it should", async ({ page }) => {\n  await test.step("1. Open the orders", async () => {\n    await page.goto("/orders");\n    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();\n    await expect(page).toHaveScreenshot({ fullPage: true });\n  });\n});\n`;
    const { outcome } = await design(replies([...write("list-orders", visual), ...valid(3).slice(2)]), { runner });
    assert.equal(outcome.tests.find((test) => test.path === "apps/shop/list-orders.spec.ts")?.verdict, "passed", messages(outcome));
    assert.ok(runner.runs.some((test) => test.content === tagged(visual)));
  });
});

describe("a model that reads images", () => {
  const screenshotParameters = (server: ScriptedServer) =>
    (server.requests[0]!.body as { tools: { function: { name: string; parameters: { properties: object } } }[] }).tools.find(
      (tool) => tool.function.name === "shop_screenshot",
    )!.function.parameters.properties;

  it("is given the screenshots of the designer when the configuration declares it, and their path alone otherwise", async () => {
    for (const vision of [true, false]) {
      const { server } = await design([{ body: answer(MODEL, "Done.") }], { vision });
      assert.equal("within" in screenshotParameters(server), vision);
    }
  });
});

describe("the packages a test may import", () => {
  it("are those the package.json of the test repository declares, and @playwright/test without one", () => {
    assert.deepEqual(
      testPackages(
        JSON.stringify({
          dependencies: { "@axe-core/playwright": "4.11.0" },
          devDependencies: { "@playwright/test": "1.64.1", "@axe-core/playwright": "4.11.0" },
        }),
      ),
      ["@axe-core/playwright", "@playwright/test"],
    );
    for (const manifest of [undefined, "{ not json", "null", "{}", JSON.stringify({ dependencies: "x", devDependencies: null })])
      assert.deepEqual(testPackages(manifest), ["@playwright/test"], String(manifest));
  });

  it("let an accessibility test import axe-core when the test repository declares it, and refuse a package it does not", async () => {
    const manifest = JSON.stringify({ devDependencies: { "@playwright/test": "1.64.1", "@axe-core/playwright": "4.11.0" } });
    const a11y = spec("list-orders")
      .replace('from "../fixtures.ts";', 'from "../fixtures.ts";\nimport AxeBuilder from "@axe-core/playwright";')
      .replace("  });\n});", "    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);\n  });\n});");
    const other = spec("x").replace('from "../fixtures.ts";', 'from "../fixtures.ts";\nimport { faker } from "@faker-js/faker";');
    const bare = `import { test as bare } from "@playwright/test";\n${spec("x")}`;
    const { outcome, server } = await design(replies([[run(other, "faker")], [run(bare, "bare")], ...write("list-orders", a11y), ...valid(3).slice(2)]), {
      root: repository(INDEX, manifest),
    });
    assert.equal(outcome.tests.find((test) => test.path === "apps/shop/list-orders.spec.ts")?.verdict, "passed", messages(outcome));
    assert.match(toolResult(server, "faker"), /Refused \(TEST-IMPORT\): Line 2 imports @faker-js\/faker; import only @axe-core\/playwright or a relative path/);
    // Playwright itself is imported through the fixtures of the repository, which the refusal names.
    assert.match(
      String(toolResult(server, "bare")),
      /Refused \(TEST-IMPORT\): Line 1 imports @playwright\/test; import test and expect from .*\.\.\/fixtures\.ts.*, the fixtures of the test repository\./,
    );

    assert.match(asked(server, 1), /\nA test may import: apps\/fixtures\.ts, @axe-core\/playwright\.\n/);
  });
});

describe("the references of a visual test", () => {
  it("are written and committed with the test, and listed in the state", async () => {
    const reference = { path: "apps/shop/list-orders.spec.ts-snapshots/list-orders-1-shop.png", content: new Uint8Array([137, 80, 78, 71]) };
    const runner: TestRunner = {
      run: async (test) => ({
        startedAt: "2026-11-13T10:00:00.000Z",
        tests: [{ id: `shop › ${test.path} › t`, verdict: "passed", reason: "ok" }],
        ...(test.path.endsWith("list-orders.spec.ts") ? { references: [reference] } : {}),
      }),
    };
    const { outcome, root } = await design(replies(valid(3)), { runner: runner as FakeTestRunner });
    assert.ok(filesOf(root).includes(reference.path));
    assert.deepEqual([...readFileSync(join(root, reference.path))], [137, 80, 78, 71]);
    assert.deepEqual(outcome.tests.find((test) => test.path === "apps/shop/list-orders.spec.ts")?.references, [reference.path]);
    assert.ok(outcome.tests.filter((test) => test.path !== "apps/shop/list-orders.spec.ts").every((test) => !("references" in test)));
  });
});

describe("the files the harness writes itself", () => {
  it("do not stop a design when they are tracked and changed, as an index committed then rewritten", async () => {
    const root = repository();
    git(root, "add", "-f", ".oqas/index");
    git(root, "commit", "-q", "-m", "chore: keep the index");
    const indexFile = join(root, ".oqas", "index", "domain-index.json");
    writeFileSync(indexFile, `${readFileSync(indexFile, "utf8")}\n`);
    const { outcome } = await design(replies(valid(3)), { root });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.match(git(root, "status", "--porcelain"), /\.oqas\/index\/domain-index\.json/);
  });
});

/** An index whose customers are described in a section of the guide, and whose guide has that section. */
const CUSTOMERS: DomainIndex = {
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
function customersRepository(): string {
  const root = repository(CUSTOMERS);
  writeFileSync(
    join(root, "specs", "guide.md"),
    "# Guide\n\n## Customer search\n\nA clerk finds a customer by the start of their last name; the list shows each match with their city.\n",
  );
  git(root, "commit", "-q", "-am", "docs: describe the search of a customer");
  return root;
}

describe("brief, criterion 1 — from the brief, the knowledge tools lead to the customers and the section of the guide, which is read", () => {
  it("finds the domain and the section, names the tool of the guide, and reads it", async () => {
    const find = { id: "f1", name: "knowledge_list", arguments: { words: "customer search" } };
    const entry = { id: "e1", name: "knowledge_read", arguments: { source: "shop-guide", item: "Customer search" } };
    const read = { id: "s1", name: "shop_guide_read_section", arguments: { number: 2 } };
    const { outcome, server } = await design(replies([[OPEN, find], [entry], [read], [PLAN], DONE, ...valid(3)]), {
      root: customersRepository(),
      plan: false,
      brief: "tester la recherche d'un client",
    });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.ok(requestText(server).includes("<brief>\\ntester la recherche d'un client\\n</brief>"));
    assert.match(toolResult(server, "f1"), /shop-guide: Customer search/);
    assert.match(
      toolResult(server, "e1"),
      /Source shop-guide \(document\): read it with shop_guide_list_files, shop_guide_list_sections, shop_guide_read_section, shop_guide_read_file, shop_guide_search\./,
    );
    assert.match(toolResult(server, "e1"), /Domains: customers\./);
    assert.match(toolResult(server, "s1"), /finds a customer by the start of their last name/);
    assert.equal(stateOf(outcome).brief, "tester la recherche d'un client");
  });
});

describe("what the workflow of a source wrote of it", () => {
  it("is given by the knowledge tools: the file of its domain, and the definition of an element from its export", async () => {
    const root = customersRepository();
    const folder = join(root, ".oqas", "index", "sources", "shop-guide");
    mkdirSync(join(folder, "domains"), { recursive: true });
    mkdirSync(join(folder, "export", "sections"), { recursive: true });
    writeFileSync(join(folder, "domains", "search.md"), "# Search (`search`)\n\n`Customer search` tells how a clerk finds a customer.");
    writeFileSync(join(folder, "export", "sections", "customer-search.md"), "## Customer search\n\nBy the start of the last name.");
    const described = { label: "Search", description: "Finding a customer." };
    writeFileSync(
      join(folder, "manifest.json"),
      JSON.stringify({
        formatVersion: 1,
        source: { id: "shop-guide", type: "document" },
        fingerprint: "sha256:0",
        producedAt: "2026-11-13T09:00:00.000Z",
        status: "complete",
        // A domain may have no file yet, or one that was lost: neither is given.
        domains: [
          { id: "search", ...described, file: "domains/search.md", writtenBy: "model" },
          { id: "pending", ...described },
          { id: "lost", ...described, file: "domains/lost.md", writtenBy: "model" },
        ],
        elements: [
          {
            name: "Customer search",
            kind: "section",
            fingerprint: "sha256:1",
            file: "export/sections/customer-search.md",
            domain: "search",
            role: "How to find a customer.",
          },
        ],
      }),
    );
    const inDomain = { id: "d1", name: "knowledge_domain", arguments: { domain: "customers", source: "shop-guide" } };
    const one = { id: "r1", name: "knowledge_read", arguments: { source: "shop-guide", item: "Customer search" } };
    const { outcome, server } = await design(replies([[OPEN, inDomain], [one], [PLAN], DONE, ...valid(3)]), { root, plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.match(toolResult(server, "d1"), /`Customer search` tells how a clerk finds a customer\./);
    assert.match(toolResult(server, "r1"), /Definition, from export\/sections\/customer-search\.md:.*## Customer search/);
  });
});

describe("a plan of as many scenarios as its brief needs", () => {
  const planOf = (...ids: string[]) => ({ ...PLAN, arguments: { scenarios: ids.map((id) => scenario(id)) } });

  it("succeeds once each of its scenarios has its test: two, or one alone", async () => {
    for (const ids of [["list-orders", "place-order"], ["list-orders"]]) {
      const { outcome } = await design(replies([[OPEN], [planOf(...ids)], DONE, ...valid(ids.length)]), { plan: false });
      assert.equal(outcome.ok, true, messages(outcome));
      assert.equal(outcome.tests.length, ids.length);
    }
  });

  it("fails, saying how many are expected, when one of them has none that counts", async () => {
    // The agent that writes the only scenario gives up: its test is kept unfinished, and counts for none.
    const { outcome } = await design(replies([[OPEN], [planOf("list-orders")], DONE, DONE, DONE, DONE, DONE]), { plan: false });
    assert.equal(outcome.ok, false);
    assert.match(messages(outcome), /The design failed: 0 tests were obtained, 1 is expected, one per scenario of the plan\./);
  });
});

describe("what the brief asks and the application does not allow", () => {
  it("goes from the plan to its file and to the outcome of the design, and is none for a plan that covers the brief", async () => {
    const uncovered = [{ asked: "Cancel an order.", reason: "No screen of shop offers to cancel one." }];
    const partial = { ...PLAN, arguments: { ...PLAN.arguments, uncovered } };
    const { outcome } = await design(replies([[OPEN], [partial], DONE, ...valid(3)]), { plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.deepEqual(outcome.uncovered, uncovered);
    assert.match(
      readFileSync(outcome.planPath!, "utf8"),
      /\n## Not covered\n\nThe brief asks what follows, and no scenario does it:\n\n- Cancel an order\. No screen of shop offers to cancel one\.\n/,
    );
    assert.match(messages(outcome), /The plan does not cover what the brief asks: Cancel an order\. No screen of shop offers to cancel one\./);
    assert.deepEqual((await design(replies(valid(3)))).outcome.uncovered, []);
  });
});

describe("the request of a brief", () => {
  it("holds the brief and the domains of the knowledge with what the sources hold of each, whatever the brief, and nothing else of the knowledge", async () => {
    const { server } = await design(replies(valid(3)), { brief: "Follow the orders" });
    const request = requestText(server);
    assert.ok(request.includes("Brief of the developer, in their words:\\n<brief>\\nFollow the orders\\n</brief>"), request);
    assert.match(request, /Knowledge of the applications, by domain:\\n- orders \(Orders\): Placing and following an order\. \d+ /);
    // No element is given: the agent explores the knowledge by levels.
    assert.ok(!request.includes("Elements:") && !request.includes("shop-api: orders"), request);
    assert.ok(
      request.includes(
        "Next: call knowledge_domain on the domain the brief is about, read what it needs, do the brief once on the screens, then call propose_plan.",
      ),
      request,
    );
    // A brief no word of which is in the knowledge is given the same domains.
    const unknown = requestText((await design(replies(valid(3)), { brief: "zebra" })).server);
    assert.match(unknown, /Knowledge of the applications, by domain:\\n- orders \(Orders\)/);
  });
});

describe("brief, criterion 2 — without an accepted plan, no test is run: the session that plans has neither run_test nor propose_test", () => {
  it("runs nothing, keeps nothing, and reminds the agent to submit the plan", async () => {
    const runner = new FakeTestRunner();
    const { outcome, server } = await design(replies([[OPEN]]), { plan: false, runner });
    assert.equal(outcome.ok, false);
    assert.deepEqual([runner.runs, outcome.tests, sessions(server).length], [[], [], 1]);
    assert.deepEqual(
      toolsOffered(server).filter((tool) => tool === "run_test" || tool === "propose_test"),
      [],
    );
    assert.match(messages(outcome), /The agent stopped without an accepted plan; it was reminded to submit one\./);
    const reminder = (server.requests[2]!.body as { messages: { role: string; content: string }[] }).messages
      .filter((message) => message.role === "user")
      .at(-1)!.content;
    assert.ok(
      reminder.endsWith(
        "\n\nYou stopped before the end. No plan is accepted yet.\nNext: read what the brief is about and do it once on the screens, then call propose_plan.",
      ),
      reminder,
    );
  });
});

describe("brief, criterion 3 — the plan is written to a file the design state names, and each test kept names its scenario", () => {
  it("keeps the plan with its brief, and the scenario of each test, in the order of the plan", async () => {
    const { outcome } = await design(replies(valid(3)), { brief: "Test the orders." });
    const state = stateOf(outcome);
    const plan = planOf(outcome);
    assert.deepEqual([plan.brief, plan.scenarios], ["Test the orders.", KEPT]);
    assert.match(readFileSync(outcome.planPath!, "utf8"), /^# Test plan design-20261113T100000Z\n\n- Environment: local\n- Brief: Test the orders\.\n/);
    assert.deepEqual(
      state.tests.map((test) => [test.path, test.scenario]),
      IDS.map((id) => [`apps/shop/${id}.spec.ts`, id]),
    );
  });
});

describe("brief, criterion 4 — a review that refuses the plan stops the task, no test is written, and the journal says so", () => {
  it("creates no branch, writes nothing, refuses every later call, and reminds the agent of nothing", async () => {
    const review: PlanReview = { review: async () => ({ accepted: false, reason: "The scenarios check only screens." }) };
    const runner = new FakeTestRunner();
    const look = { id: "look", name: "shop_goto", arguments: { url: "/orders" } };
    const { outcome, root, server, before } = await design(
      [
        { body: toolCalls(MODEL, [OPEN]) },
        { body: toolCalls(MODEL, [PLAN, run(spec("x"), "r1")]) },
        { body: toolCalls(MODEL, [COVERED]) },
        { body: toolCalls(MODEL, [{ ...PLAN, id: "plan-2" }, look]) },
        { body: answer(MODEL, "Done.") },
      ],
      { plan: false, planReview: review, runner },
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.branch, undefined);
    // The trace of the session is all the design left.
    assert.deepEqual({ ...snapshot(root), status: "" }, { ...before, status: "" });
    assert.deepEqual(
      git(root, "status", "--porcelain", "--untracked-files=all")
        .split("\n")
        .filter((line) => !line.includes(".oqas/index/")),
      [`?? .oqas/traces/${outcome.tracePath!.split("/").at(-1)}`],
    );
    assert.deepEqual(runner.runs, []);
    assert.match(messages(outcome), /The plan was refused: The scenarios check only screens\. The design stops; no test is written\./);
    assert.match(messages(outcome), /No test was written: the plan was refused: The scenarios check only screens\./);
    for (const id of ["plan-2", "look"])
      assert.match(toolResult(server, id), /The plan was refused: The scenarios check only screens\. The design is stopped; call no more tools\./);
    assert.equal(server.requests.length, 5);
  });
});

describe("the plan of a design", () => {
  it("refuses two scenarios of one id, then accepts the plan fixed, and no second plan", async () => {
    const twice = {
      id: "plan-twice",
      name: "propose_plan",
      arguments: { scenarios: ["list-orders", "list-orders", "follow-order"].map((id) => scenario(id)) },
    };
    const again = { ...PLAN, id: "plan-again" };
    const { outcome, server } = await design(replies([[OPEN], [twice], [PLAN], [COVERED], [again], DONE, ...valid(3)]), { plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.equal(
      told(server, "plan-twice"),
      "Refused (PLAN-ID): the id list-orders is given to several scenarios. Give each scenario its own id.\nNothing else was refused.",
    );
    assert.match(messages(outcome), /\[PLAN-ID\] The plan was refused by the harness: the id list-orders/);
    // Once the plan is accepted, the session that plans is over: every call is refused.
    assert.match(toolResult(server, "plan-again"), /The plan is accepted, and this session is over\. Answer with one sentence; call no more tools\./);
    assert.match(messages(outcome), /The plan was accepted: list-orders, place-order, follow-order\./);
  });

  it("reminds an agent that stopped after a refused plan of the codes it was refused for", async () => {
    const twice = {
      id: "plan-twice",
      name: "propose_plan",
      arguments: { scenarios: ["list-orders", "list-orders", "follow-order"].map((id) => scenario(id)) },
    };
    const { server } = await design(replies([[OPEN], [twice]]), { plan: false });
    const reminder = (server.requests[3]!.body as { messages: { role: string; content: string }[] }).messages
      .filter((message) => message.role === "user")
      .at(-1)!.content;
    assert.match(reminder, /\nYou stopped before the end\. The plan was last refused for: PLAN-ID\.\nNext: /);
  });
});

describe("a brief no test can do", () => {
  it("keeps a plan without a scenario that says why, writes no test nor branch, and succeeds", async () => {
    const uncovered = [{ asked: "Change the address of a customer.", reason: "No screen of shop offers to edit an address." }];
    const none = { id: "plan", name: "propose_plan", arguments: { scenarios: [], uncovered } };
    const { outcome, root, server } = await design(replies([[OPEN], [none], DONE]), { plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.deepEqual([outcome.tests, outcome.branch, outcome.uncovered], [[], undefined, uncovered]);
    assert.match(told(server, "plan"), /^The plan was accepted with 0 scenarios: the agent said no test can do what the brief asks\./);
    assert.deepEqual([planOf(outcome).scenarios, planOf(outcome).ended], [[], "none"]);
    assert.match(readFileSync(outcome.planPath!, "utf8"), /\n## Not covered\n/);
    assert.match(messages(outcome), /No test was written: the plan holds no scenario, and says what the brief asks that no test can do\./);
    // Nothing is committed: the test repository is on the branch it was on.
    assert.equal(git(root, "symbolic-ref", "--short", "HEAD"), "main");
    // The session that plans is over once the plan is accepted: no session writes a test.
    assert.equal(server.requests.length, 3);
  });
});

describe("the duplicates of a design", () => {
  it("sets aside the scenarios another covers, by the code then by the agent that reviews the plan in a session of its own, keeps a test that runs what another runs as a duplicate, and succeeds with the tests left", async () => {
    // The scenario seen-orders does and expects what list-orders does; the reviewer finds follow-order in place-order.
    const same = scenario("seen-orders", "other", { data: scenario("list-orders").data });
    const plan = { ...PLAN, arguments: { scenarios: [...IDS.map((id) => scenario(id)), same] } };
    const report = {
      id: "report",
      name: "report_duplicates",
      arguments: { duplicates: [{ id: "follow-order", of: "place-order", reason: "Both follow\nthe same order." }] },
    };
    // The test of place-order comes back as that of list-orders under another title: the agent is warned, and closes it as it is.
    const copied = spec("list-orders").replace('test("list-orders"', 'test("place-order"');
    const { outcome, root } = await design(
      // The review runs in a session of its own while the plan is submitted: its turns come before the next of the agent that plans.
      replies([[OPEN], [plan], [report], DONE, DONE, ...write("list-orders"), [run(copied, "r-copy")], [close("c-1")], [close("c-2")], DONE]),
      { plan: false, reviewPlan: true },
    );
    assert.equal(outcome.ok, true, messages(outcome));
    const recorded = planOf(outcome);
    assert.deepEqual(
      [recorded.scenarios.map((kept) => kept.id), recorded.ended, recorded.setAside!.map((aside) => [aside.id, aside.duplicates, aside.origin.by])],
      [
        ["list-orders", "place-order"],
        "session-end",
        [
          ["follow-order", "place-order", "agent"],
          ["seen-orders", "list-orders", "harness"],
        ],
      ],
    );
    assert.deepEqual(
      outcome.tests.map((test) => [test.path, test.classes.at(-1)!.class, test.duplicates]),
      [
        ["apps/shop/list-orders.spec.ts", "passed", undefined],
        ["apps/shop/place-order.spec.ts", "duplicate", "apps/shop/list-orders.spec.ts"],
      ],
    );
    // The duplicate stays on the branch, and the commit says what it is.
    assert.match(git(root, "log", "-1", "--format=%B", BRANCH), /- apps\/shop\/place-order\.spec\.ts: duplicate of apps\/shop\/list-orders\.spec\.ts/);
    assert.match(readFileSync(outcome.planPath!, "utf8"), /\n## Set aside\n/);
    assert.doesNotMatch(messages(outcome), /The design failed/);
  });
});

describe("plans submitted in one turn", () => {
  it("accept one plan only", async () => {
    const other = { id: "plan-other", name: "propose_plan", arguments: { scenarios: ["a-one", "a-two", "a-three"].map((id) => scenario(id)) } };
    const { outcome, server } = await design(replies([[OPEN], [PLAN, COVERED, other], DONE, ...valid(3)]), { plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.equal(outcome.journal.filter((entry) => entry.message.startsWith("The plan was accepted")).length, 1);
    assert.match(toolResult(server, "plan-other"), /The plan is accepted, and this session is over\./);
  });

  it("are refused once the review refused one of them", async () => {
    const review: PlanReview = { review: async () => ({ accepted: false, reason: "Not now." }) };
    const { outcome, server } = await design(
      [{ body: toolCalls(MODEL, [OPEN]) }, { body: toolCalls(MODEL, [PLAN, COVERED, { ...PLAN, id: "plan-2" }]) }, { body: answer(MODEL, "Done.") }],
      { plan: false, planReview: review },
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.journal.filter((entry) => entry.message.startsWith("The plan was refused: Not now.")).length, 1);
    assert.match(toolResult(server, "plan-2"), /The plan was refused: Not now\. The design is stopped/);
  });
});

describe("what a plan may hold", () => {
  it("refuses the value of a declared variable, the plan being written to a file, and cites a source the index does not list", async () => {
    const leaky = {
      id: "plan-leaky",
      name: "propose_plan",
      arguments: {
        scenarios: [scenario("list-orders", "other", { data: [{ value: DB_URL, from: "shop" }] }), scenario("place-order"), scenario("follow-order")],
      },
    };
    const beyond = {
      id: "plan-beyond",
      name: "propose_plan",
      arguments: {
        scenarios: [
          scenario("list-orders", "other", { sources: [{ source: "shop-guide", item: "Guide" }] }),
          scenario("place-order"),
          scenario("follow-order"),
        ],
      },
    };
    const guide = { id: "guide", name: "shop_guide_list_sections", arguments: {} };
    const { outcome, server } = await design(replies([[OPEN], [leaky], [guide], [beyond], DONE, ...valid(3)]), { plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.match(
      toolResult(server, "plan-leaky"),
      /Refused \(PLAN-SECRET\): the plan holds the value of SHOP_DB_URL\. Leave it out; a test reads it with process\.env\.SHOP_DB_URL\./,
    );
    assert.ok(!messages(outcome).includes(DB_URL));
    assert.deepEqual(planOf(outcome).scenarios[0]!.sources, [{ source: "shop-guide", item: "Guide" }]);
  });

  it("refuses a functional scenario none of whose texts an action of the agent made appear, and accepts it once the agent searched", async () => {
    const found = { result: "The order shows", shows: ["Order 42 of Ada"], absent: [] };
    const functional = (id: string, kase: string, search: number) =>
      scenario(id, "functional", {
        case: kase,
        // A negative scenario holds the input that matches nothing.
        data: kase === "negative" ? [{ value: "zzqx", from: "made-up" }] : [],
        steps: [
          { action: "Open the orders", actions: [1], expects: [] },
          { action: "Search the orders", actions: [search], expects: [found] },
        ],
      });
    /** The plan, whose second steps cite the action that searched. */
    const plan = (id: string, search: number) => ({
      id,
      name: "propose_plan",
      arguments: { scenarios: [functional("list-orders", "nominal", search), functional("place-order", "negative", search), scenario("follow-order")] },
    });
    const { outcome, server } = await design(replies([[OPEN], [plan("seen", 1)], [SEARCH], [plan("done", 2)]]), { plan: false });
    assert.match(
      toolResult(server, "seen"),
      /Refused \(PLAN-RESULT\): no text scenario list-orders expects appeared, or went, after an action of yours on shop\. Do its steps with shop_goto, shop_fill and shop_click/,
    );
    assert.match(toolResult(server, "search"), /Order 42 of Ada/);
    assert.match(told(server, "done"), /^The plan is not closed yet\. It holds 3 scenarios: list-orders, place-order, follow-order\.\n/);
    // The plan kept holds the code of the action each step cites: the sheet of its first scenario gives it, and the text asserted on the element that shows it, a paragraph without a name.
    assert.ok(
      asked(server, 1).includes(
        [
          '  await test.step("1. Open the orders", async () => {',
          '    await page.goto("/orders");',
          "  });",
          '  await test.step("2. Search the orders", async () => {',
          "    await shop.orders.searchButton.click();",
          "    // Expect 2.1: The order shows.",
          '    await expect(page.getByText("Order 42 of Ada", { exact: true })).toBeVisible();',
          "  });",
        ].join("\n"),
      ),
      asked(server, 1),
    );
    assert.deepEqual(planOf(outcome).scenarios[0]!.steps, [
      {
        action: "Open the orders",
        code: ['await page.goto("/orders");'],
        lines: [{ application: "shop", screen: "/orders", code: 'await page.goto("/orders");' }],
        expects: [],
      },
      {
        action: "Search the orders",
        code: ["await shop.orders.searchButton.click();"],
        lines: [{ application: "shop", screen: "/orders", code: 'await page.getByRole("button", { name: "Search", exact: true }).click();' }],
        expects: [{ ...found, elements: [{ text: "Order 42 of Ada", locator: 'page.getByText("Order 42 of Ada", { exact: true })', field: false }] }],
      },
    ]);
    assert.ok(
      readFileSync(outcome.planPath!, "utf8").includes(
        [
          "### Step 2. Search the orders",
          "",
          "```ts",
          "await shop.orders.searchButton.click();",
          "```",
          "",
          "Expect 2.1: The order shows.",
          '- shows "Order 42 of Ada" in `page.getByText("Order 42 of Ada", { exact: true })`',
          "",
        ].join("\n"),
      ),
    );
    // The result of an action gives its number, which the plan cites.
    assert.match(toolResult(server, "search"), /\\"action\\":2/);
  });
});

describe("the element of an expected text", () => {
  it("is checked on the page: several that share a locator are asked about once, and the test asserts on the one accepted, or on any of them by their number", async () => {
    const paired = scenario("list-orders", "other", {
      steps: [{ action: "Open the pairs", actions: [2], expects: [{ result: "The pairs show", shows: ["Open", "Due"], absent: [] }] }],
    });
    const plan = (id: string, accepts?: number[]) => ({
      id,
      name: "propose_plan",
      arguments: { scenarios: [paired, scenario("place-order"), scenario("follow-order")], ...(accepts === undefined ? {} : { accepts }) },
    });
    const pairs = { id: "pairs", name: "shop_goto", arguments: { url: "/pairs" } };
    const sheetOf = (text: string) => text.slice(text.indexOf("import "), text.lastIndexOf("\nNext:"));
    const { server, outcome } = await design(replies([[OPEN], [pairs], [plan("asked")], [plan("answered", [2])], DONE]), { plan: false });
    const due = 'page.getByRole("region", { name: "Late orders" }).getByRole("heading", { name: "Due", exact: true })';
    assert.equal(
      told(server, "asked"),
      [
        "The plan is not accepted yet. The harness looked on the page for the element of each expected text, and asks you about 2 of them, once:",
        'Warning 1: "Open" (scenario list-orders, expect 1.1) is shown by 2 elements of shop, and the harness found no locator of one of them alone. If any of them will do, put 1 in accepts: the test will then assert that one of them at least shows it, or that none is left. Otherwise expect a more precise text, such as the text of the whole row.',
        `Proposal 2: "Due" (scenario list-orders, expect 1.1) is shown by 2 elements of shop. The harness proposes to assert it on one of them alone: ${due}. Check that it is the element you mean: if it is, put 2 in accepts. Otherwise expect a more precise text, such as the text of the whole row.`,
        "Next: call propose_plan again with the plan, what you correct in it, and accepts. What you leave unanswered is asserted on any of its elements, and is not asked again.",
      ].join("\n"),
    );
    const sheet = sheetOf(asked(server, 1));
    assert.ok(
      sheet.includes(
        [
          '    await page.goto("/pairs");',
          "    // Expect 1.1: The pairs show.",
          '    await expect(page.getByRole("heading", { name: "Open", exact: true }).filter({ visible: true })).not.toHaveCount(0);',
          `    await expect(${due}).toBeVisible();`,
        ].join("\n"),
      ),
      sheet,
    );
    assert.match(
      messages(outcome),
      /The agent left warning 1 unanswered: "Open" is asserted on any of the 2 elements page\.getByRole\("heading", \{ name: "Open", exact: true \}\)\.\nThe agent accepted proposal 2: "Due" is asserted on /,
    );
    // The skeleton runs as it is: an assertion by the number of the elements keeps the text of the plan.
    const ran = await design(replies([[OPEN], [pairs], [plan("asked")], [plan("answered", [2])], DONE, [run(sheet, "whole")]]), { plan: false });
    assert.match(told(ran.server, "whole"), /^Run of the file: passed\./);
  });
});

describe("the screens a test relies on", () => {
  it("showed each locator of the test", async () => {
    const invented = spec("list-orders").replace('name: "Orders"', 'name: "Orders to deliver"');
    const far = spec("list-orders").replace("  });\n});", '    await page.getByTestId("zzqx").click();\n  });\n});');
    // The session of a scenario saw only what it looked at itself: it opens the orders before it names an element of them.
    const { outcome, server } = await design(replies([[run(far, "far")], [{ ...OPEN, id: "again" }], [run(invented, "invented")], ...valid(3)]));
    assert.equal(outcome.ok, true, messages(outcome));
    assert.match(
      told(server, "invented"),
      /^Refused \(TEST-LOCATOR\): no screen you looked at showed getByRole\("heading", \{ name: "Orders to deliver" \}\)\.\nClosest elements you saw:\n- heading "Orders" \[level=1\]\n- textbox "Search orders" → [^\n]+\nCopy a locator as given, or take shop_snapshot at that step\.\nNothing else was refused\.$/,
    );
    assert.match(told(server, "far"), /^Refused \(TEST-LOCATOR\): no screen you looked at showed getByTestId\("zzqx"\)\.\nCopy a locator as given/);
    // Opening the page gave the agent what it shows, each element with its locator.
    assert.match(toolResult(server, "open"), /heading .*Orders.*getByRole/);
  });
});

describe("the trace of a design", () => {
  const lines = (path: string) =>
    readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as { phase: string; actor: string; event: { type: string; outcome?: string; tool?: string; text?: string; message?: string } },
      );

  it("holds the request, each call of the agent with its result, the journal, and ends as done", async () => {
    const seen: string[] = [];
    const { outcome } = await design(replies(valid(3)), { observe: (line) => seen.push(line.event.type) });
    const trace = lines(outcome.tracePath!);
    // One phase for the session that plans, then one for the session of each scenario, each with what it asked of the model.
    const of = (type: string) => trace.filter((line) => line.actor === "harness" && line.event.type === type);
    assert.deepEqual(
      of("started").map((line) => line.phase),
      ["plan", "write", "write", "write"],
    );
    assert.deepEqual(
      of("finished").map((line) => [line.phase, line.event.outcome]),
      [
        ["plan", "done"],
        ["write", "done"],
        ["write", "done"],
        ["write", "done"],
      ],
    );
    assert.deepEqual(
      of("usage").map((line) => [line.phase, (line.event as { requests?: number }).requests]),
      [
        ["plan", 3],
        ["write", 3],
        ["write", 3],
        ["write", 3],
      ],
    );
    assert.equal(trace[0]!.event.type, "started");
    assert.deepEqual(
      of("message").map((line) => line.event.text!.split("\n")[0]),
      ["Plan Playwright tests for the environment local.", ...IDS.map(() => "Write the test of this scenario for the environment local.")],
    );
    // The journal is traced in the phase it was written in.
    assert.deepEqual(
      trace
        .filter((line) => line.event.type === "journal" && /^The (plan was accepted|scenario list-orders was opened)/.test(line.event.message!))
        .map((line) => line.phase),
      ["plan", "write"],
    );
    assert.deepEqual(
      trace.filter((line) => line.actor === "agent" && line.event.type === "tool-call").map((line) => line.event.tool),
      ["shop_goto", "propose_plan", ...IDS.flatMap(() => ["run_test", "propose_test"])],
    );
    assert.ok(
      trace.some(
        (line) =>
          line.event.type === "journal" && line.event.message === "The scenario list-orders was closed: passed; its test is apps/shop/list-orders.spec.ts.",
      ),
    );
    assert.equal(seen.length, trace.length);
    assert.ok(!readFileSync(outcome.tracePath!, "utf8").includes(PASSWORD));
  });

  it("ends a phase as truncated when a limit cut its session, as failed when the session did not give what it was for, and is not opened without a session", async () => {
    const late = (id: string) => run(spec("late"), id);
    const cut = await design(replies([...valid(3).slice(0, 8), [late("l1")], [late("l2")], [late("l3")]]), {
      limits: { maxIterations: 4, maxMinutes: 10, maxActions: 200 },
    });
    assert.equal(cut.outcome.ok, true, messages(cut.outcome));
    const outcomes = (path: string) =>
      lines(path)
        .filter((line) => line.event.type === "finished")
        .map((line) => line.event.outcome);
    assert.deepEqual(outcomes(cut.outcome.tracePath!), ["done", "done", "done", "truncated"]);
    // The limit cut nothing of the plan: every scenario was closed before it.
    assert.equal(cut.outcome.stoppedBy, undefined);
    // The session of a scenario the agent left open did not give its test.
    const few = await design(replies(valid(2)));
    assert.deepEqual(outcomes(few.outcome.tracePath!), ["done", "done", "done", "failed"]);
    const none = await design(replies([]), { plan: false });
    assert.deepEqual(outcomes(none.outcome.tracePath!), ["failed"]);
    const dirty = repository();
    writeFileSync(join(dirty, "specs", "orders.md"), "changed\n");
    const stopped = await design(replies(valid(3)), { root: dirty });
    assert.equal(stopped.outcome.tracePath, undefined);
    assert.ok(!existsSync(join(dirty, ".oqas", "traces")));
  });
});

describe("resume — a design a limit stopped goes on from its plan and its tests, on its branch", () => {
  /** The relative path of the state of the design of the helper. */
  const STATE = ".oqas/designs/design-20261113T100000Z.json";
  /** A design the limit of a session stopped: the plan is accepted, the first test kept, the second run but not closed when its session reaches its fourth model call. */
  const stopped = (brief?: string) =>
    design(replies([...valid(1), [run(spec("place-order"), "r-place-order")], [look("l1")], [look("l2")], [look("l3")]]), {
      limits: { maxIterations: 4, maxMinutes: 10, maxActions: 200 },
      ...(brief === undefined ? {} : { brief }),
    });

  it("keeps the plan and the test of a design a limit stopped, and names the limit", async () => {
    const { outcome, root } = await stopped();
    assert.deepEqual([outcome.ok, outcome.stoppedBy, outcome.branch], [false, "iterations", BRANCH]);
    assert.deepEqual(specsOf(root), ["apps/shop/list-orders.spec.ts"]);
    const state = stateOf(outcome);
    assert.deepEqual([planOf(outcome).scenarios.map((scenario) => scenario.id), state.tests.map((test) => test.scenario)], [IDS, ["list-orders"]]);
  });

  it("gives each session the sheet of its scenario alone, offers no plan tool, and ends on the same branch with every test, written from the sheets without a look at a screen", async () => {
    const first = await stopped();
    const before = git(first.root, "rev-parse", BRANCH);
    git(first.root, "switch", "--quiet", "main");
    // The session resumed opens no page: the code and the locators of its tests are those its sheets give, from the plan.
    const { outcome, root, server } = await design(replies(valid(3).slice(3)), {
      root: first.root,
      plan: false,
      resume: { state: STATE, branch: BRANCH },
    });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.equal(outcome.stoppedBy, undefined);
    const request = requestText(server);
    // The first session is that of the first scenario not closed: it is given neither the plan nor the test kept.
    assert.ok(!request.includes("list-orders"));
    assert.match(request, /Scenario 2 of 3: place-order/);
    assert.deepEqual(
      sessions(server).map((body) => /Scenario \d of 3: [a-z-]+/.exec(firstMessage(body))?.[0]),
      ["Scenario 2 of 3: place-order", "Scenario 3 of 3: follow-order"],
    );
    assert.ok(
      request.includes(
        JSON.stringify(
          '    await page.goto("/orders");\n    // Expect 1.1: The orders show.\n    await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();',
        ).slice(1, -1),
      ),
    );
    assert.ok(!toolsOffered(server).includes("propose_plan"));
    assert.equal(git(root, "branch", "--show-current"), BRANCH);
    assert.deepEqual(specsOf(root), ["apps/shop/follow-order.spec.ts", "apps/shop/list-orders.spec.ts", "apps/shop/place-order.spec.ts"]);
    assert.equal(git(root, "rev-parse", `${BRANCH}~1`), before);
    const state = stateOf(outcome);
    assert.equal(outcome.statePath, join(root, STATE));
    assert.deepEqual(
      state.tests.map((test) => test.scenario),
      IDS,
    );
    assert.deepEqual([state.plan, outcome.planPath], [stateOf(first.outcome).plan, first.outcome.planPath]);
    assert.deepEqual(planOf(outcome), planOf(first.outcome));
    assert.ok(filesOf(root).includes(state.plan));
    // What every session used, those of the design resumed included.
    assert.equal(state.run.iterations, 3 + 3 + 4 + 3 + 3);
  });

  it("keeps a plan accepted without a test, with no branch, and creates the branch once the design resumed writes one", async () => {
    const first = await design(replies([[run(spec("list-orders"), "r1")], [look("l1")], [look("l2")], [look("l3")]]), {
      limits: { maxIterations: 4, maxMinutes: 10, maxActions: 200 },
    });
    assert.deepEqual([first.outcome.stoppedBy, first.outcome.branch, first.outcome.tests], ["iterations", undefined, []]);
    assert.match(
      messages(first.outcome),
      /The design state was written to \S+\.json, and its plan to \S+\.plan\.md; no new test was written, and nothing was committed\./,
    );
    assert.equal(git(first.root, "branch", "--list", BRANCH), "");
    // The revision checked out moves before the design is resumed: the branch starts from where it is now.
    writeFileSync(join(first.root, "notes.md"), "Notes.\n");
    git(first.root, "add", "notes.md");
    git(first.root, "commit", "--quiet", "-m", "docs: add notes");
    const head = git(first.root, "rev-parse", "HEAD");
    assert.notEqual(stateOf(first.outcome).base, head);
    const again = await design(replies(valid(3)), { root: first.root, plan: false, resume: { state: STATE, branch: BRANCH } });
    assert.equal(again.outcome.ok, true, messages(again.outcome));
    assert.match(requestText(again.server), /Scenario 1 of 3: list-orders/);
    assert.equal(specsOf(again.root).length, 3);
    assert.ok(filesOf(again.root).includes(stateOf(again.outcome).plan), "the plan is committed with the first tests");
    assert.equal(stateOf(again.outcome).base, head);
    assert.equal(git(again.root, "rev-parse", `${BRANCH}~1`), head);
  });

  it("keeps the brief of the design, in its state and in the file of its plan", async () => {
    const first = await stopped("Test the orders.");
    const { outcome } = await design(replies(valid(3).slice(3)), { root: first.root, plan: false, resume: { state: STATE, branch: BRANCH } });
    const state = stateOf(outcome);
    assert.deepEqual([state.brief, planOf(outcome).brief, state.tests.map((test) => test.scenario)], ["Test the orders.", "Test the orders.", IDS]);
  });

  it("names the limit that stops a design before its plan, and writes nothing", async () => {
    const { outcome, root } = await design(replies([[OPEN]]), { plan: false, limits: { maxIterations: 1, maxMinutes: 10, maxActions: 200 } });
    assert.deepEqual([outcome.ok, outcome.stoppedBy, outcome.statePath], [false, "iterations", undefined]);
    assert.ok(!existsSync(join(root, ".oqas", "designs")));
  });

  it("commits nothing when the design resumed is stopped again before a new test", async () => {
    const first = await stopped();
    const before = git(first.root, "rev-parse", BRANCH);
    const { outcome } = await design(replies([[look("l1")], [look("l2")]]), {
      root: first.root,
      plan: false,
      resume: { state: STATE, branch: BRANCH },
      limits: { maxIterations: 1, maxMinutes: 10, maxActions: 200 },
    });
    assert.deepEqual([outcome.stoppedBy, outcome.tests.length], ["iterations", 1]);
    assert.equal(git(first.root, "rev-parse", BRANCH), before);
    assert.equal(stateOf(outcome).run.iterations, 3 + 3 + 4 + 1);
  });

  it("refuses a state it cannot read, or of an earlier format, and a plan missing, or that a hand changed", async () => {
    const missing = await design([], { plan: false, resume: { state: ".oqas/designs/none.json" } });
    assert.match(messages(missing.outcome), /The design state \.oqas\/designs\/none\.json cannot be read; the design was not resumed\./);
    const first = await stopped();
    const state = join(first.root, STATE);
    const plan = first.outcome.planPath!;
    const again = () => design([], { root: first.root, plan: false, resume: { state: STATE, branch: BRANCH } });
    const accepted = readFileSync(plan, "utf8");
    writeFileSync(plan, accepted.replace("Open the orders", "Open the list of the orders"));
    const edited = await again();
    assert.match(
      messages(edited.outcome),
      /The plan \.oqas\/designs\/design-20261113T100000Z\.plan\.md of the design state \.oqas\/designs\/design-20261113T100000Z\.json cannot be read; the design was not resumed\./,
    );
    rmSync(plan);
    assert.match(messages((await again()).outcome), /The plan \S+ of the design state \S+ cannot be read; the design was not resumed\./);
    writeFileSync(state, readFileSync(state, "utf8").replace('"formatVersion": 4', '"formatVersion": 3'));
    const dated = await again();
    assert.match(messages(dated.outcome), /The design state \.oqas\/designs\/design-20261113T100000Z\.json cannot be read; the design was not resumed\./);
    assert.equal(edited.server.requests.length + dated.server.requests.length, 0);
  });

  it("refuses a plan with every scenario closed, and a changed working tree", async () => {
    const done = await design(replies(valid(3)));
    const closed = await design([], { root: done.root, plan: false, resume: { state: STATE, branch: BRANCH } });
    assert.match(messages(closed.outcome), /Every scenario of the plan of .* is closed; there is nothing to resume\./);
    const first = await stopped();
    writeFileSync(join(first.root, "specs", "orders.md"), "changed\n");
    const dirty = await design([], { root: first.root, plan: false, resume: { state: STATE, branch: BRANCH } });
    assert.match(messages(dirty.outcome), /Tracked files are changed: specs\/orders\.md\.\nThe design was not resumed\./);
    assert.equal(dirty.server.requests.length, 0);
  });
});

describe("the levels of the pyramid of tests a plan is asked for", () => {
  it("are those the caller names, or smoke, functional and business, told to the agent that plans", async () => {
    const { outcome, server } = await design(replies(valid(3)), { levels: ["functional", "cross-application"] });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.match(JSON.stringify(server.requests[0]!.body), /Levels of the pyramid of tests asked: functional, cross-application\./);
    const usual = await design(replies(valid(3)), { levels: "default" });
    assert.match(JSON.stringify(usual.server.requests[0]!.body), /Levels of the pyramid of tests asked: smoke, functional, business\./);
  });
});

describe("the count of the harness — each scenario of a plan is accounted for", () => {
  const givenUp = (id: string): Call => ({ id, name: "propose_test", arguments: { unfeasible: { reason: "The shop offers no way to follow an order." } } });

  it("succeeds with a scenario the agent that writes gave up with its reason, says so, and counts no test for it", async () => {
    const turns = [...valid(2), [run(broken("follow-order"), "r-follow-order")], [givenUp("g1")], [givenUp("g2")], DONE];
    const { outcome } = await design(replies(turns));
    assert.equal(outcome.ok, true, messages(outcome));
    assert.deepEqual(
      outcome.tests.map((test) => [test.scenario, test.classes.at(-1)!.class]),
      [
        ["list-orders", "passed"],
        ["place-order", "passed"],
        ["follow-order", "unfeasible"],
      ],
    );
    assert.match(
      messages(outcome),
      /Scenarios of the plan without a test, the agent that writes having said why \(1 of 3\): follow-order \(The shop offers no way to follow an order\.\)/,
    );
  });

  it("fails when a scenario has neither a test that counts nor a reason, and says how many are expected", async () => {
    const { outcome } = await design(replies([...valid(1), [run(broken("place-order"), "r-place-order")], [givenUp("g1")], [givenUp("g2")], DONE]));
    assert.equal(outcome.ok, false);
    assert.match(messages(outcome), /The design failed: 1 test was obtained, 2 are expected, one per scenario of the plan\./);
  });
});

describe("the review of each test for coherence with its scenario", () => {
  it("is done by an agent of its own, in a session of its own, once the test passed, and kept with the test", async () => {
    const report = (id: string, findings: unknown[]): Call => ({ id, name: "report_findings", arguments: { findings } });
    // The review of a test runs while its scenario is closed: its turns come before the next of the agent that writes.
    const reviewed = (name: string, findings: unknown[] = []) => [
      [run(spec(name), `r-${name}`)],
      [close(`c-${name}`)],
      [report(`f-${name}`, findings)],
      DONE,
      DONE,
    ];
    const fault = [{ where: "step 1", what: "No assertion verifies the orders." }];
    const turns = [
      ...reviewed("list-orders"),
      // The second test is found at fault: the agent that wrote it is told once, and keeps it as it is.
      ...reviewed("place-order", fault).slice(0, 4),
      [close("c2-place-order")],
      DONE,
      ...reviewed("follow-order"),
    ];
    const { outcome, server } = await design(replies(turns), { reviewTests: true });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.deepEqual(
      outcome.tests.map((test) => [test.scenario, test.classes.at(-1)!.class, test.review?.findings]),
      [
        ["list-orders", "passed", []],
        ["place-order", "passed", fault],
        ["follow-order", "passed", []],
      ],
    );
    assert.match(told(server, "c-place-order"), /^Warning \(TEST-COHERENCE\): another agent read the test of scenario place-order against its sheet/);
    assert.deepEqual(stateOf(outcome).tests[1]!.review!.findings, fault);
  });
});

describe("the review of the code of each test for its quality", () => {
  it("is done by an agent of its own, with the instructions of the caller, after the review of coherence, and kept with the test", async () => {
    const report = (id: string, name: string, findings: unknown[]): Call => ({ id, name, arguments: { findings } });
    const dated = [{ where: "step 1", what: "The count asserted changes with the data.", concerns: "plan" }];
    // Each review runs in a session of its own while the scenario is closed: coherence first, then the code.
    const reviewed = (name: string, findings: unknown[] = []) => [
      [run(spec(name), `r-${name}`)],
      [close(`c-${name}`)],
      [report(`f-${name}`, "report_findings", [])],
      DONE,
      [report(`q-${name}`, "report_quality", findings)],
      DONE,
      DONE,
    ];
    const { outcome, server } = await design(replies([...reviewed("list-orders", dated), ...reviewed("place-order"), ...reviewed("follow-order")]), {
      reviewTests: true,
      reviewCode: true,
      reviewerInstructions: "Review the code against the charter.",
    });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.deepEqual(
      outcome.tests.map((test) => [test.scenario, test.review?.findings, test.quality?.findings]),
      [
        ["list-orders", [], dated],
        ["place-order", [], []],
        ["follow-order", [], []],
      ],
    );
    assert.ok(JSON.stringify(server.requests.map((request) => request.body)).includes("Review the code against the charter."));
    // Without the instructions of a reviewer, or when the review of the code is not asked, no code is reviewed.
    for (const setup of [{ reviewCode: true }, { reviewerInstructions: "Review the code against the charter." }]) {
      const plain = await design(replies(valid(3)), setup);
      assert.deepEqual(
        plain.outcome.tests.map((test) => test.quality),
        [undefined, undefined, undefined],
      );
    }
  });
});
