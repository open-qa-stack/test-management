import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { CopilotAgentRuntime, designerInstructions, ModelGateway, resolveCharter } from "@open-qa-stack/harness";
import { validateConfig, type DomainIndex, type ResolvedConfig, type SourceCard } from "@open-qa-stack/shared";
import { answer, scriptedServer, testSite, toolCalls, type ScriptedServer, type TestSite } from "@open-qa-stack/testing";
import { moduleSyntax } from "@open-qa-stack/tools";
import type { PlanReview, ProposedTest, TestCheck, TestRunner, TestTrial } from "@open-qa-stack/domain";
import { testPackages } from "../src/designer/spec-rules.ts";
import { Designer, type DesignOutcome, type DesignState } from "../src/index.ts";

const MODEL = "test-model";
const BRANCH = "oqas/design-test";
const USERNAME = "ada.lovelace@example.com";
const PASSWORD = "Tr0ub4dor&3";
const ENV = { SHOP_USERNAME: USERNAME, SHOP_PASSWORD: PASSWORD, SHOP_DB_URL: "postgresql://shop:s3cret-db-pass@127.0.0.1:5999/shop" };

let site: TestSite;
let workspace: string;

before(async () => {
  // The orders page shows an order once it is searched for.
  const orders = `<h1>Orders</h1><input aria-label="Search orders"><button onclick="document.getElementById('found').hidden = false">Search</button><p id="found" hidden>Order 42 of Ada</p>`;
  site = await testSite({ "/": "<h1>Shop</h1>", "/orders": orders });
  workspace = mkdtempSync(join(tmpdir(), "oqas-designer-"));
});

after(async () => {
  await site.close();
  rmSync(workspace, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function configFor(modelUrl: string, limits = { maxIterations: 20, maxDurationMinutes: 10, maxActions: 200 }): ResolvedConfig {
  const text = JSON.stringify({
    formatVersion: 1,
    applications: [
      {
        id: "shop",
        name: "Shop",
        type: "web-and-api",
        authentication: { method: "form", accounts: [{ name: "demo", usernameEnv: "SHOP_USERNAME", passwordEnv: "SHOP_PASSWORD" }] },
        environments: [{ name: "local", uiUrl: `${site.origin}/`, apis: [{ name: "shop-backend", baseUrl: "http://127.0.0.1:8090" }] }, { name: "staging", uiUrl: "http://shop.test" }],
      },
      { id: "ledger", name: "Ledger", type: "api", authentication: { method: "none" }, environments: [{ name: "local", apis: [{ name: "api", baseUrl: "http://ledger.test:8100" }] }] },
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
    autonomy: { level: "custom", task: limits, batch: { maxTests: 4, maxIdleRounds: 1 }, guardrailMinutes: 1 },
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

/** The test of a scenario whose one step opens the orders and asserts their heading, as the plan expects. */
const spec = (title: string) =>
  `import { test, expect } from "@playwright/test";\n\ntest("${title}", async ({ page }) => {\n  await test.step("1. Open the orders", async () => {\n    await page.goto("/orders");\n    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();\n  });\n});\n`;

/** A call of a tool by the model. */
interface Call {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

/** A scenario of the plan, about the orders of the shop: its one step opens them and expects their heading. */
const scenario = (id: string, kind = "other", changes: Record<string, unknown> = {}) => ({
  id,
  title: `The ${id} scenario`,
  intent: `Verifies ${id}.`,
  kind,
  case: "nominal",
  application: "shop",
  domain: "orders",
  sources: [{ source: "shop-api", item: "orders" }],
  data: [],
  steps: [{ action: "Open the orders", expects: [{ result: "The orders show", shows: ["Orders"], absent: [] }] }],
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

/** A call of `run_test`. */
const run = (content: string, id: string): Call => ({ id, name: "run_test", arguments: { content } });
/** A call of `propose_test`, with a diagnosis when one is given. */
const close = (id: string, diagnosis?: { cause: string; evidence: string }): Call => ({ id, name: "propose_test", arguments: diagnosis === undefined ? {} : { diagnosis } });
/** The turns that run, then close, the test of the scenario open, each call in a turn of its own. */
const write = (name: string, content = spec(name), diagnosis?: { cause: string; evidence: string }): Call[][] => [[run(content, `r-${name}`)], [close(`c-${name}`, diagnosis)]];
/** The turns that write the tests of the first scenarios of the plan, each passing. */
const valid = (count: number) => IDS.slice(0, count).flatMap((id) => write(id));
/** The replies that make the calls of each turn, then answer enough to end the task and every reminder. */
const replies = (turns: readonly (readonly Call[])[]) => [...turns.map((calls) => ({ body: toolCalls(MODEL, calls) })), ...Array.from({ length: 4 }, () => ({ body: answer(MODEL, "Done.") }))];
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
    const failed = { id, verdict: "failed" as const, reason: "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('heading', { name: 'Orders' })\nExpected: visible\nReceived: hidden", failedStep: "open the orders", trace: ".oqas/test-results/trace.zip" };
    return { startedAt: "2026-11-13T10:00:00.000Z", tests: [broken ? failed : { id, verdict: "passed", reason: "Every attempt passed." }] };
  }
}

interface Setup {
  readonly runner?: FakeTestRunner;
  readonly root?: string;
  readonly limits?: { maxIterations: number; maxDurationMinutes: number; maxActions: number };
  readonly check?: TestCheck;
  readonly branch?: string | null;
  readonly env?: Readonly<Record<string, string>>;
  /** Whether the plan is submitted before the script; it is by default. */
  readonly plan?: boolean;
  readonly brief?: string;
  readonly planReview?: PlanReview;
  readonly observe?: (line: { event: { type: string } }) => void;
}

interface Run {
  readonly outcome: DesignOutcome;
  readonly root: string;
  readonly server: ScriptedServer;
  readonly before: Record<string, string>;
}

async function design(script: readonly { status?: number; body: unknown }[], setup: Setup = {}): Promise<Run> {
  // The designer looks at the orders page and submits its plan first, in a turn of their own, unless the test scripts it.
  const server = await scriptedServer(setup.plan === false ? script : [{ body: toolCalls(MODEL, [OPEN, PLAN]) }, ...script]);
  const gateway = await ModelGateway.start({ kind: "live", upstream: { baseUrl: server.baseUrl } });
  const runtime = new CopilotAgentRuntime({ endpoint: gateway, model: MODEL, homeDirectory: mkdtempSync(join(workspace, "home-")) });
  const root = setup.root ?? repository();
  const before = existsSync(join(root, ".git")) || existsSync(join(root, "..", ".git")) ? snapshot(root) : {};
  try {
    const config = configFor(server.baseUrl, setup.limits);
    const charter = resolveCharter(config.charter);
    assert.ok(charter.ok);
    const designer = new Designer({
      config,
      repositoryRoot: root,
      env: setup.env ?? ENV,
      runtime,
      instructions: designerInstructions(charter.rules, config.repository),
      browser: { actionTimeoutMs: 1000, navigationTimeoutMs: 3000 },
      ...(setup.branch === null ? {} : { branch: setup.branch ?? BRANCH, now: () => new Date("2026-11-13T10:00:00.000Z") }),
      ...(setup.check === undefined ? {} : { check: setup.check }),
      runner: setup.runner ?? new FakeTestRunner(),
      ...(setup.brief === undefined ? {} : { brief: setup.brief }),
      ...(setup.planReview === undefined ? {} : { planReview: setup.planReview }),
      ...(setup.observe === undefined ? {} : { observe: setup.observe }),
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
const toolsOffered = (server: ScriptedServer) => (server.requests[0]!.body as { tools: { function: { name: string } }[] }).tools.map((tool) => tool.function.name);
const requestText = (server: ScriptedServer) => JSON.stringify(server.requests[0]!.body);

/** The text of the result of a tool call, as the next request gives it to the model. */
const toolResult = (server: ScriptedServer, callId: string) => {
  for (const request of server.requests) {
    const found = (request.body as { messages: { role: string; tool_call_id?: string; content?: unknown }[] }).messages.find((message) => message.role === "tool" && message.tool_call_id === callId);
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
const specsOf = (root: string, branch = BRANCH) => filesOf(root, branch).filter((path) => path.endsWith(".spec.ts"));

describe("criterion 1 — three valid tests are written on a new branch, in the folder of their application, with a state", () => {
  it("writes exactly three spec files and the state that lists them, commits them on the branch, and stays on it", async () => {
    const { outcome, root, server } = await design(replies(valid(3)));
    assert.equal(outcome.ok, true);
    assert.equal(git(root, "branch", "--show-current"), BRANCH);
    assert.deepEqual(specsOf(root), ["apps/shop/follow-order.spec.ts", "apps/shop/list-orders.spec.ts", "apps/shop/place-order.spec.ts"]);
    assert.equal(readFileSync(join(root, "apps", "shop", "list-orders.spec.ts"), "utf8"), spec("list-orders"));
    const state = stateOf(outcome);
    assert.equal(outcome.statePath, join(root, ".oqas", "designs", "design-20261113T100000Z.json"));
    assert.ok(filesOf(root).includes(".oqas/designs/design-20261113T100000Z.json"));
    assert.deepEqual(state.tests, IDS.map((id) => ({ path: `apps/shop/${id}.spec.ts`, scenario: id, verdict: "passed", runs: [{ verdict: "passed" }] })));
    assert.deepEqual([state.formatVersion, state.plan, state.brief], [2, PLAN.arguments, undefined]);
    assert.deepEqual(outcome.tests, state.tests);
    assert.deepEqual([state.branch, state.base, state.environment, state.producedAt, state.model.model], [BRANCH, git(root, "rev-parse", "main"), "local", "2026-11-13T10:00:00.000Z", MODEL]);
    assert.deepEqual(git(root, "log", "-1", "--format=%an <%ae>%n%B", BRANCH).split("\n").slice(0, 4), ["Test Maintainer <maintainer@example.com>", "test: add 3 generated Playwright tests", "", "- apps/shop/list-orders.spec.ts: The list-orders scenario"]);
    assert.match(messages(outcome), /The design state was written to \.oqas\/designs\/design-20261113T100000Z\.json\.\nThe tests were committed on oqas\/design-test; the active branch of the test repository is oqas\/design-test\./);
    assert.equal(git(root, "status", "--porcelain", "--untracked-files=no"), "");
    assert.equal(server.requests.length, 8);
  });

  it("gives the agent the charter, the domains of the index and its tools, the screens, every source of the environment and the notes", async () => {
    const { server } = await design(replies(valid(3)));
    const tools = toolsOffered(server);
    assert.ok(["shop_goto", "propose_plan", "run_test", "propose_test", "remember", "recall", "index_find", "index_entry"].every((tool) => tools.includes(tool)));
    for (const source of ["order_specs_", "shop_guide_", "shop_api_", "ledger_api_", "shop_db_query"]) assert.ok(tools.some((tool) => tool.startsWith(source)), source);
    assert.deepEqual(tools.filter((tool) => /^(staging_specs|legacy)_/.test(tool)), []);
    const request = requestText(server);
    for (const fragment of [
      "PW-WAIT-01",
      "No brief was given",
      "- orders (Orders): Placing and following an order.",
      "- customers (Customers): The customers of the shop.",
      "- shop (Shop, web-and-api): signs in with a form; account demo: username in process.env.SHOP_USERNAME, password in process.env.SHOP_PASSWORD.",
      "- ledger (Ledger, api): no sign-in.",
    ]) {
      assert.ok(request.includes(JSON.stringify(fragment).slice(1, -1)), fragment);
    }
    assert.ok(!request.includes("Legacy"));
    // The index is looked up, not given whole.
    assert.ok(!request.includes("Lists and places the orders of a customer."));
  });

  it("names the branch after the date by default, ends the file with a new line, and leaves out a state git ignores", async () => {
    const root = repository();
    writeFileSync(join(root, ".gitignore"), ".oqas/\n");
    git(root, "add", ".gitignore");
    git(root, "commit", "-q", "-m", "chore: ignore the state");
    const { outcome } = await design(replies([...valid(2), ...write("follow-order", spec("follow-order").trimEnd())]), { root, branch: null });
    assert.match(outcome.branch!, /^oqas\/design-\d{8}T\d{6}Z$/);
    assert.equal(readFileSync(join(root, "apps", "shop", "follow-order.spec.ts"), "utf8"), spec("follow-order"));
    assert.ok(!filesOf(root, outcome.branch).some((path) => path.startsWith(".oqas/")));
    assert.ok(existsSync(outcome.statePath!));
    assert.match(messages(outcome), /which git ignores: it was not committed\./);
  });
});

describe("criterion 2 — a plan holds four scenarios at most, and each gives one test", () => {
  it("writes the four tests of a plan of four scenarios, then refuses any further call", async () => {
    const four = { ...PLAN, arguments: { scenarios: [...IDS, "cancel-order"].map((id) => scenario(id)) } };
    const after = run(spec("late"), "late");
    const { outcome, root, server } = await design([{ body: toolCalls(MODEL, [OPEN, four]) }, ...replies([...valid(3), ...write("cancel-order"), [after]])], { plan: false });
    assert.equal(outcome.tests.length, 4);
    assert.equal(specsOf(root).length, 4);
    assert.match(told(server, "c-cancel-order"), /Scenario cancel-order closed: passed\.\nAll 4 scenarios are closed: 4 passed, 0 failing, 0 without a test\.\nNext: answer with one sentence\. Call no more tools\./);
    assert.match(toolResult(server, "late"), /Refused \(PLAN-DONE\): every scenario of the plan is closed\./);
  });
});

describe("criterion 3 — with two valid tests the design fails, the journal says 2, and both files are on the branch", () => {
  it("reminds the agent, then keeps the two tests and fails", async () => {
    const { outcome, root, server } = await design(replies(valid(2)));
    assert.equal(outcome.ok, false);
    assert.match(messages(outcome), /The design failed: 2 tests were obtained, 3 at least are expected\./);
    assert.match(messages(outcome), /The agent stopped before scenario follow-order was closed; it was reminded to go on\./);
    assert.deepEqual(specsOf(root), ["apps/shop/list-orders.spec.ts", "apps/shop/place-order.spec.ts"]);
    const reminder = (server.requests.at(-1)!.body as { messages: { role: string; content: string }[] }).messages.filter((message) => message.role === "user").at(-1)!.content;
    assert.match(reminder, /\nYou stopped before the end\. Scenario 3 of 3, follow-order: its test has not run\.\nNext: do the steps of follow-order with the browser tools/);
  });

  it("reminds an agent that stopped of where the scenario open stands", async () => {
    const done = { body: answer(MODEL, "Done.") };
    const { server } = await design([{ body: toolCalls(MODEL, [run(spec("list-orders"), "r1")]) }, done, { body: toolCalls(MODEL, [run(broken("list-orders"), "r2")]) }, done, done, done]);
    const reminders = server.requests.flatMap((request) => (request.body as { messages: { role: string; content: string }[] }).messages.filter((message) => message.role === "user").slice(1).map((message) => message.content.split("\n\n").at(-1)!));
    assert.deepEqual([...new Set(reminders)], [
      "You stopped before the end. Scenario 1 of 3, list-orders: its test passed and is not closed.\nNext: call propose_test.",
      "You stopped before the end. Scenario 1 of 3, list-orders: its last run failed.\nNext: look at the page at the failed step, fix the locator or the wait, then call run_test with the whole corrected file (failed runs: 1 of 3).",
    ]);
  });

  it("writes nothing and creates no branch when no test was obtained, the session failing", async () => {
    const { outcome, root, before } = await design([{ status: 500, body: { error: { message: "down" } } }]);
    assert.equal(outcome.ok, false);
    assert.match(messages(outcome), /The session failed: .*\n[^]*No test was written: 0 tests were obtained/);
    assert.deepEqual(snapshot(root).branches, before.branches);
  });
});

describe("criterion 4 — a test that imports anything but @playwright/test or a relative path is not run, and the journal names the module", () => {
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
    assert.match(journal, /\[TEST-IMPORT\] The test apps\/shop\/list-orders\.spec\.ts could not be run: Line 1 imports @open-qa-stack\/agents; import only @playwright\/test/);
    assert.match(journal, /\[TEST-IMPORT\] .*: Line 1 imports a module whose name is computed/);
    assert.match(journal, /\[TEST-IMPORT\] .*: Line 1 imports \.\.\/\.\.\/\.\.\/outside\.ts, outside the test repository\./);
    assert.match(journal, /\[TEST-IMPORT\] .*: Line 1 imports \.\/test-1\.spec\.ts, another test file/);
    assert.match(told(server, "platform"), /^Refused \(TEST-IMPORT\): Line 1 imports @open-qa-stack\/agents; .*\nNothing else was refused\.$/);
    assert.deepEqual([runner.runs.length, runner.runs[0]!.content], [3, helped]);
    assert.equal(readFileSync(join(root, "apps", "shop", "list-orders.spec.ts"), "utf8"), helped);
  });
});

describe("criterion 5 — a test that does not parse as TypeScript is not run, and the journal holds the parse error", () => {
  it("refuses it with the line and column of the error", async () => {
    const { outcome } = await design(replies([[run(`import { test } from "@playwright/test";\ntest("x", async () => {\n`, "parse")], ...valid(3)]));
    assert.match(messages(outcome), /\[TEST-SYNTAX\] The test apps\/shop\/list-orders\.spec\.ts could not be run: The test does not parse as TypeScript: line \d+, column \d+: (missing|unexpected) /);
    assert.equal(outcome.ok, true);
  });
});

describe("criterion 6 — a test that holds a declared address or the value of an account variable is not run", () => {
  it("refuses an address, a host, a username and a password, and masks the values in the journal", async () => {
    const runner = new FakeTestRunner();
    const { outcome, server } = await design(
      replies([
        [
          run(spec("x").replace(`"/orders"`, `"${site.origin}/orders"`), "address"),
          run(spec("x").replace(`"/orders"`, `"//ledger.test:8100/orders"`), "host"),
          run(spec("x").replace(`"/orders"`, `"/login?user=${encodeURIComponent(USERNAME)}"`), "login"),
          run(`const password = "${PASSWORD}";\ntest("x", async () => {\n`, "leaky"),
        ],
        [run(broken("list-orders"), "failing")],
        [close("leaked", { cause: "application", evidence: `It signs in with ${PASSWORD}.` })],
        [look("again")],
        ...valid(3),
      ]),
      { runner },
    );
    const journal = messages(outcome);
    assert.match(journal, new RegExp(`\\[TEST-ADDRESS\\] .*: The test holds ${site.origin.replaceAll(".", "\\.")}, an address of the configuration`));
    assert.match(journal, /\[TEST-ADDRESS\] .*: The test holds ledger\.test:8100, an address of the configuration/);
    assert.match(journal, /\[TEST-SECRET\] .*: The proposal holds the value of SHOP_USERNAME; read it with process\.env\.SHOP_USERNAME instead\./);
    assert.match(toolResult(server, "leaked"), /Refused \(PROPOSE-SECRET\): the diagnosis holds the value of SHOP_PASSWORD\. Leave it out; a test reads it with process\.env\.SHOP_PASSWORD\./);
    assert.match(journal, /\[TEST-SYNTAX\] .*: The test does not parse as TypeScript: line 1, column 1: unexpected "const password = \\"\[secret\]\\";"/);
    assert.equal(runner.runs.length, 4);
    const told = server.requests.flatMap((request) => (request.body as { messages: { role: string; content: unknown }[] }).messages.filter((message) => message.role === "tool"));
    const traces = [journal, JSON.stringify(told)].join("\n");
    assert.ok(!traces.includes(PASSWORD) && !traces.includes(USERNAME) && !traces.includes(encodeURIComponent(USERNAME)));
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
    const { outcome, root } = await design([...valid(1).map((calls) => ({ body: toolCalls(MODEL, calls) })), { body: toolCalls(MODEL, [...actions, run(spec("place-order"), "late")]) }, { body: answer(MODEL, "Done.") }]);
    assert.match(messages(outcome), /The task reached its actions limit; no test was written for the scenario under way\./);
    assert.deepEqual(specsOf(root), ["apps/shop/list-orders.spec.ts"]);
    assert.match(messages(outcome), /The design failed: 1 test was obtained, 3 at least are expected\./);
  });
});

describe("criterion 10 — no generated test imports another, and nothing is written in the journeys or the blocks", () => {
  it("holds for three and two tests", async () => {
    for (const count of [3, 2]) {
      const { root } = await design(replies(valid(count)));
      const files = filesOf(root);
      assert.deepEqual(files.filter((path) => path.startsWith("parcours/") || path.includes("/blocs/")), []);
      for (const path of files.filter((file) => file.endsWith(".spec.ts"))) {
        const syntax = await moduleSyntax(readFileSync(join(root, path), "utf8"));
        assert.ok(syntax.ok);
        assert.deepEqual(syntax.imports.map((imported) => imported.module), ["@playwright/test"]);
      }
    }
  });
});

describe("criterion 11 — the designer imports neither the SDK nor a package its package may not depend on", () => {
  it("imports only node modules, its own files and @open-qa-stack/domain, shared and tools", () => {
    const folder = new URL("../src/", import.meta.url);
    const files = readdirSync(folder, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".ts"));
    const imported = files.flatMap((file) => [...readFileSync(new URL(file, folder), "utf8").matchAll(/^(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["'];$|^import\s*["']([^"']+)["'];$/gm)].map((match) => (match[1] ?? match[2])!));
    const allowed = (module: string) => module.startsWith("node:") || module.startsWith(".") || ["@open-qa-stack/domain", "@open-qa-stack/shared", "@open-qa-stack/tools"].includes(module);
    assert.ok(files.some((file) => file.startsWith("designer")));
    assert.deepEqual(imported.filter((module) => !allowed(module)), []);
  });
});

describe("guiding the designer", () => {
  it("refuses a test the check finds fault with, each finding with its line, its rule or code, and the example of its rule", async () => {
    const check: TestCheck = {
      check: async (proposed) =>
        proposed.content.includes("waits")
          ? [
              { kind: "charter", rule: "PW-WAIT-01", line: 4, column: 9, message: "Wait for a state, never for a fixed time.", example: 'await expect(page.getByRole("table")).toBeVisible();' },
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
    assert.match(messages(outcome), /\[TEST-CHECK\] The test apps\/shop\/list-orders\.spec\.ts could not be run: Line 1, column 1 \(rule TEAM-TAG-01\): Tag the test\./);
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
    assert.deepEqual(outcome.tests.map((test) => test.path), ["apps/shop/list-orders-3.spec.ts", "apps/shop/place-order.spec.ts", "apps/shop/follow-order.spec.ts"]);
    assert.equal(readFileSync(join(root, "apps", "shop", "list-orders.spec.ts"), "utf8"), "// kept\n");
    assert.match(toolResult(server, "plan"), /File: apps\/shop\/list-orders-3\.spec\.ts/);
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
    const searched = scenario("list-orders", "other", { case: "negative", data: [{ value: "Ada", from: "shop" }, { value: "zzqx", from: "made-up" }] });
    const plan = { ...PLAN, arguments: { scenarios: [searched, scenario("place-order"), scenario("follow-order")] } };
    const { server } = await design([{ body: toolCalls(MODEL, [OPEN, plan]) }, ...replies(valid(1))], { plan: false });
    const sheet = told(server, "plan");
    assert.ok(
      sheet.startsWith(
        'The plan was accepted.\n\nScenario 1 of 3: list-orders — The list-orders scenario (other, negative), application shop.\nData: "Ada" (shop); "zzqx" (made-up).\nFile: apps/shop/list-orders.spec.ts\n\nimport { expect, test } from "@playwright/test";\n\ntest("The list-orders scenario", async ({ page }) => {\n  await test.step("1. Open the orders", async () => {\n    // Do: Open the orders. Copy the code lines the browser tools returned.\n    // Expect 1.1: The orders show.\n    await expect(page.getByText(\"Orders\")).toBeVisible();\n  });\n});\n',
      ),
      sheet,
    );
    assert.ok(sheet.endsWith("Next: do the steps of list-orders with the browser tools, fill its skeleton with the code they return, then call run_test."));
    assert.match(told(server, "c-list-orders"), /^Scenario list-orders closed: passed\.\n\nScenario 2 of 3: place-order — .*\nData: none\.\nFile: apps\/shop\/place-order\.spec\.ts/);
  });
});

describe("loop, criterion 1 — a test that fails, then is fixed, is run twice and passes", () => {
  it("runs the broken text, then the fixed one, and keeps the test as passed", async () => {
    const runner = new FakeTestRunner();
    const { outcome, server } = await design(replies([[run(broken("list-orders"), "r1")], [look("l1")], ...valid(3)]), { runner });
    assert.deepEqual(runner.runs.filter((test) => test.path === "apps/shop/list-orders.spec.ts").map((test) => test.content.includes("BROKEN")), [true, false]);
    assert.equal(outcome.tests.find((test) => test.path === "apps/shop/list-orders.spec.ts")?.verdict, "passed");
    assert.equal(runner.runs.length, 4, "a scenario is closed with the text of its last run, which is not run again");
    assert.match(messages(outcome), /The test apps\/shop\/list-orders\.spec\.ts was run: failed\.\nThe test apps\/shop\/list-orders\.spec\.ts was run: passed\./);
    assert.match(told(server, "r-list-orders"), /^Run of the file: passed\.\n- shop › apps\/shop\/list-orders\.spec\.ts › the test: passed\.\nNext: call propose_test\.$/);
  });
});

describe("loop, criterion 2 — the result told to the agent holds the assertion, the failed step and the trace", () => {
  it("gives the error in full, the step, the trace and the instant to read the logs from", async () => {
    const { server } = await design(replies([[run(broken("list-orders"), "r1")], [look("l1")], ...valid(3)]));
    const told = toolResult(server, "r1");
    for (const part of ["Run of the file: failed.", "expect(locator).toBeVisible() failed", "getByRole('heading', { name: 'Orders' })", "Failed step: open the orders", "Trace: .oqas/test-results/trace.zip", "since 2026-11-13T10:00:00.000Z", "Next: look at the page at the failed step"]) assert.ok(told.includes(part), part);
  });

  it("refuses to run a test the rules refuse, and tells why when a test cannot run", async () => {
    const runner = new FakeTestRunner();
    const { server } = await design(replies([[run(`import fs from "node:fs";\n${spec("list-orders")}`, "r1")], ...valid(3)]), { runner });
    assert.match(toolResult(server, "r1"), /Refused \(TEST-IMPORT\): Line 1 imports node:fs/);
    assert.ok(runner.runs.every((test) => !test.content.includes("node:fs")));
    const failing = new FakeTestRunner("The browsers of Playwright 1.64.1 could not be installed: offline");
    const cannot = await design(replies(valid(1)), { runner: failing });
    assert.match(toolResult(cannot.server, "r-list-orders"), /Run of the file: it could not run: The browsers of Playwright 1\.64\.1 could not be installed: offline/);
    assert.match(toolResult(cannot.server, "c-list-orders"), /Refused \(PROPOSE-RUN\): scenario list-orders has not run to a verdict\. Call run_test first\./);
    assert.equal(cannot.outcome.tests.length, 0);
    assert.match(messages(cannot.outcome), /The test apps\/shop\/list-orders\.spec\.ts could not run: The browsers/);
  });
});

describe("loop, criterion 3 — the runs count against the limits, and a test not fixed is never kept as passed", () => {
  it("stops at the limit of iterations, and keeps no test that did not pass", async () => {
    const trials = Array.from({ length: 6 }, (_, i) => ({ body: toolCalls(MODEL, [run(`${broken("list-orders")}// ${i}\n`, `r${i}`)]) }));
    const { outcome } = await design([...trials, { body: answer(MODEL, "Done.") }], { limits: { maxIterations: 3, maxDurationMinutes: 10, maxActions: 200 } });
    assert.match(messages(outcome), /The task reached its iterations limit/);
    assert.deepEqual(outcome.tests, []);
    assert.equal(outcome.ok, false);
  });

  it("refuses to close a scenario whose last run failed without a diagnosis, and one that has not run", async () => {
    const { outcome, server } = await design(replies([[close("early")], [run(broken("list-orders"), "r1")], [close("blind")], [look("l1")], ...valid(3)]));
    assert.match(toolResult(server, "early"), /Refused \(PROPOSE-RUN\): scenario list-orders has not run\. Call run_test first\./);
    assert.match(toolResult(server, "blind"), /Refused \(PROPOSE-DIAG\): the last run of scenario list-orders failed\. Repair it with run_test \(failed runs: 1 of 3\), or give diagnosis: the cause and what the run showed\./);
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
      runs: [{ verdict: "failed", errorClass: "assertion", failedStep: "open the orders" }],
      quarantine: { cause: "application", evidence: "The total stays empty although the order has two lines.", failedStep: "open the orders", errorClass: "assertion" },
    });
    assert.equal(readFileSync(join(root, "apps", "shop", "follow-order.spec.ts"), "utf8"), broken("follow-order"));
    assert.match(git(root, "log", "-1", "--format=%B", BRANCH), /- apps\/shop\/follow-order\.spec\.ts: failing \(application\)/);
    assert.match(told(server, "c-follow-order"), /Scenario follow-order closed: failing \(application\), kept for a person to decide\.\nAll 3 scenarios are closed: 2 passed, 1 failing, 0 without a test\./);
    const own = await design(replies([...valid(2), ...write("follow-order", broken("follow-order"), { cause: "plan", evidence: "The heading of the plan is wrong." })]));
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
    assert.match(told(server, "f1"), /\nThe application shows hidden where the plan expects visible\. The expected text stays\. .*\nFailed runs of list-orders: 1 of 3\.\nNext: look at the page at the failed step, fix the locator or the wait, then call run_test with the whole corrected file \(failed runs: 1 of 3\)\.$/);
    assert.equal(told(server, "blind"), 'Refused (TEST-LOOK): look before you run again. Take shop_snapshot at the step that failed ("open the orders"), or read the logs since 2026-11-13T10:00:00.000Z.\nNothing else was refused.');
    assert.equal(told(server, "same"), "Refused (TEST-SAME): this text already failed, and nothing changed. Fix the locator or the wait the error names, or call propose_test with diagnosis.\nNothing else was refused.");
    assert.match(told(server, "early"), /^Refused \(PROPOSE-EARLY\): failed runs: 1 of 3\. Try a repair with run_test before giving up on the test itself\.\n/);
    assert.match(told(server, "f3"), /\nThe element is not on the screen at that step\. .*\nFailed runs of list-orders: 3 of 3\.\nNext: call propose_test with diagnosis\.$/);
    assert.match(told(server, "cause"), /^Refused \(PROPOSE-CAUSE\): cause "application" does not fit: the run failed on locator at step "1\. Open the orders", before any check of the application\. Fix the locator, or give cause "test"\.\n/);
    assert.match(told(server, "stop"), /^Refused \(TEST-STOP\): scenario list-orders failed 3 runs\. Do not run it again\. Call propose_test with diagnosis/);
    assert.match(told(server, "kept"), /^Scenario list-orders closed: failing \(test\), kept for a person to decide\./);
    assert.equal(runner.runs.filter((test) => test.path === "apps/shop/list-orders.spec.ts").length, 3);
    const kept = stateOf(outcome).tests[0]!;
    assert.deepEqual([kept.runs, kept.quarantine], [
      [{ verdict: "failed", errorClass: "assertion", failedStep: "open the orders" }, { verdict: "failed", errorClass: "assertion", failedStep: "open the orders" }, { verdict: "failed", errorClass: "locator", failedStep: "1. Open the orders" }],
      { cause: "test", evidence: "The search button cannot be reached.", failedStep: "1. Open the orders", errorClass: "locator" },
    ]);
    assert.match(git(root, "log", "-1", "--format=%B", BRANCH), /- apps\/shop\/list-orders\.spec\.ts: failing \(test\) at step 1\n/);
    assert.match(messages(outcome), /\[TEST-LOOK\] The test apps\/shop\/list-orders\.spec\.ts could not be run: look before you run again/);
  });

  it("closes without a test a scenario whose three runs gave no verdict, and counts a read of the code as a look", async () => {
    const runner = new FakeTestRunner("The browsers of Playwright could not be installed: offline");
    const code = (id: string): Call => ({ id, name: "shop_code_list_files", arguments: {} });
    const turns = [[run(spec("a"), "n1")], [code("c1")], [run(spec("b"), "n2")], [look("l1")], [run(spec("c"), "n3")], [close("gone")]];
    const { outcome, server } = await design(replies(turns), { runner });
    assert.match(told(server, "n2"), /^Run of the file: it could not run: .*offline\nFailed runs of list-orders: 2 of 3\./);
    assert.match(told(server, "gone"), /^Scenario list-orders closed without a test: none of its runs gave a verdict\.\n\nScenario 2 of 3: place-order/);
    assert.match(messages(outcome), /The scenario list-orders was closed without a test: none of its 3 runs gave a verdict\./);
    assert.deepEqual([runner.runs.length, outcome.tests], [3, []]);
  });

  it("keeps a test failing on another error than an assertion only as the test's fault, with every run, even one that gave no verdict", async () => {
    const runner: TestRunner = {
      run: async (test) => (test.content.includes("OFFLINE") ? { startedAt: "2026-11-13T10:00:00.000Z", tests: [], error: "offline" } : { startedAt: "2026-11-13T10:00:00.000Z", tests: [{ id: `shop › ${test.path} › t`, verdict: "failed", reason: "ReferenceError: total is not defined" }] }),
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
    assert.match(told(server, "cause"), /^Refused \(PROPOSE-CAUSE\): cause "application" does not fit: the run failed on other, before any check of the application\./);
    assert.match(told(server, "blind"), /^Refused \(TEST-LOOK\): look before you run again\. Take shop_snapshot at the step that failed, or read the logs since /);
    const kept = stateOf(outcome).tests[0]!;
    assert.deepEqual([kept.runs, kept.quarantine], [[{}, { verdict: "failed", errorClass: "other" }, { verdict: "failed", errorClass: "other" }], { cause: "test", evidence: "The total cannot be read.", errorClass: "other" }]);
    assert.match(git(root, "log", "-1", "--format=%B", BRANCH), /- apps\/shop\/list-orders\.spec\.ts: failing \(test\)$/m);
  });

  it("tells a look at an application without a user interface by its logs and its code", async () => {
    const ledger = { ...PLAN, arguments: { scenarios: IDS.map((id) => scenario(id, "other", { application: "ledger" })) } };
    const { server } = await design(replies([[OPEN, ledger], [run(broken("list-orders"), "f1")], [run(`${broken("list-orders")}// 2\n`, "blind")]]), { plan: false });
    assert.equal(told(server, "blind"), 'Refused (TEST-LOOK): look before you run again. Read the logs since 2026-11-13T10:00:00.000Z, or the source code, at the step that failed ("open the orders").\nNothing else was refused.');
  });
});

describe("what a run tells the agent", () => {
  it("cuts a long error, and counts a file whose run gives no test as not run", async () => {
    const long: TestRunner = { run: async (test) => ({ startedAt: "2026-11-13T10:00:00.000Z", tests: [{ id: `shop › ${test.path} › t`, verdict: "failed", reason: "x".repeat(5000) }] }) };
    const cut = await design(replies(valid(1)), { runner: long as FakeTestRunner });
    const told = toolResult(cut.server, "r-list-orders");
    assert.ok(told.includes(`${"x".repeat(1500)}…`) && !told.includes("x".repeat(1501)) && !told.includes("Failed step"));
    const empty: TestRunner = { run: async () => ({ startedAt: "2026-11-13T10:00:00.000Z", tests: [] }) };
    const none = await design(replies(valid(1)), { runner: empty as FakeTestRunner });
    assert.match(toolResult(none.server, "r-list-orders"), /Run of the file: not_run\./);
    assert.deepEqual(none.outcome.tests, []);
  });
});

describe("what the designer may keep", () => {
  it("keeps a passing test as passed whatever the diagnosis claims", async () => {
    const { outcome } = await design(replies([...valid(2), ...write("follow-order", spec("follow-order"), { cause: "application", evidence: "The service returns no total." })]));
    const kept = outcome.tests.find((test) => test.scenario === "follow-order");
    assert.deepEqual([kept?.verdict, kept !== undefined && "quarantine" in kept], ["passed", false]);
  });

  it("never keeps a test that did not run to a verdict, even with a diagnosis", async () => {
    for (const verdict of ["skipped", "blocked"] as const) {
      const runner: TestRunner = { run: async (test) => ({ startedAt: "2026-11-13T10:00:00.000Z", tests: [{ id: `shop › ${test.path} › t`, verdict, reason: "x" }] }) };
      const { outcome, server } = await design(replies(write("list-orders", spec("list-orders"), { cause: "application", evidence: "The application is down." })), { runner: runner as FakeTestRunner });
      assert.deepEqual(outcome.tests, [], verdict);
      assert.match(toolResult(server, "c-list-orders"), /Refused \(PROPOSE-RUN\): scenario list-orders has not run to a verdict/);
    }
  });

  it("refuses a test that writes a file, without running it", async () => {
    const runner = new FakeTestRunner();
    const writes = spec("list-orders").replace("  });\n", "    await page.screenshot({ path: \"/tmp/x.png\" });\n  });\n");
    const { outcome } = await design(replies([[run(writes, "r1")], ...valid(3)]), { runner });
    assert.match(messages(outcome), /\[TEST-FILE\] The test apps\/shop\/list-orders\.spec\.ts could not be run: The test writes a file/);
    assert.ok(runner.runs.every((test) => !test.content.includes("screenshot")));
  });
});

describe("a visual test", () => {
  it("is run and kept: it opens a page and compares a full capture with its reference", async () => {
    const runner = new FakeTestRunner();
    const visual = `import { test, expect } from "@playwright/test";\n\ntest("the list of orders looks as it should", async ({ page }) => {\n  await test.step("1. Open the orders", async () => {\n    await page.goto("/orders");\n    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();\n    await expect(page).toHaveScreenshot({ fullPage: true });\n  });\n});\n`;
    const { outcome } = await design(replies([...write("list-orders", visual), ...valid(3).slice(2)]), { runner });
    assert.equal(outcome.tests.find((test) => test.path === "apps/shop/list-orders.spec.ts")?.verdict, "passed", messages(outcome));
    assert.ok(runner.runs.some((test) => test.content === visual));
  });
});

describe("the packages a test may import", () => {
  it("are those the package.json of the test repository declares, and @playwright/test without one", () => {
    assert.deepEqual(testPackages(JSON.stringify({ dependencies: { "@axe-core/playwright": "4.11.0" }, devDependencies: { "@playwright/test": "1.64.1", "@axe-core/playwright": "4.11.0" } })), ["@axe-core/playwright", "@playwright/test"]);
    for (const manifest of [undefined, "{ not json", "null", "{}", JSON.stringify({ dependencies: "x", devDependencies: null })]) assert.deepEqual(testPackages(manifest), ["@playwright/test"], String(manifest));
  });

  it("let an accessibility test import axe-core when the test repository declares it, and refuse a package it does not", async () => {
    const manifest = JSON.stringify({ devDependencies: { "@playwright/test": "1.64.1", "@axe-core/playwright": "4.11.0" } });
    const a11y = spec("list-orders").replace('from "@playwright/test";', 'from "@playwright/test";\nimport AxeBuilder from "@axe-core/playwright";').replace("  });\n});", "    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);\n  });\n});");
    const other = spec("x").replace('from "@playwright/test";', 'from "@playwright/test";\nimport { faker } from "@faker-js/faker";');
    const { outcome, server } = await design(replies([[run(other, "faker")], ...write("list-orders", a11y), ...valid(3).slice(2)]), { root: repository(INDEX, manifest) });
    assert.equal(outcome.tests.find((test) => test.path === "apps/shop/list-orders.spec.ts")?.verdict, "passed", messages(outcome));
    assert.match(toolResult(server, "faker"), /Refused \(TEST-IMPORT\): Line 2 imports @faker-js\/faker; import only @playwright\/test, @axe-core\/playwright or a relative path/);
    assert.match(JSON.stringify(server.requests[0]!.body), /Import only the packages of the test repository \(@playwright\/test, @axe-core\/playwright\)/);
  });
});

describe("the references of a visual test", () => {
  it("are written and committed with the test, and listed in the state", async () => {
    const reference = { path: "apps/shop/list-orders.spec.ts-snapshots/list-orders-1-shop.png", content: new Uint8Array([137, 80, 78, 71]) };
    const runner: TestRunner = { run: async (test) => ({ startedAt: "2026-11-13T10:00:00.000Z", tests: [{ id: `shop › ${test.path} › t`, verdict: "passed", reason: "ok" }], ...(test.path.endsWith("list-orders.spec.ts") ? { references: [reference] } : {}) }) };
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
  domains: [INDEX.domains[0]!, { ...INDEX.domains[1]!, references: [{ source: "shop-api", items: ["customers"] }, { source: "shop-guide", items: ["Customer search"] }] }],
};

/** A test repository whose guide describes the search of a customer. */
function customersRepository(): string {
  const root = repository(CUSTOMERS);
  writeFileSync(join(root, "specs", "guide.md"), "# Guide\n\n## Customer search\n\nA clerk finds a customer by the start of their last name; the list shows each match with their city.\n");
  git(root, "commit", "-q", "-am", "docs: describe the search of a customer");
  return root;
}

describe("brief, criterion 1 — from the brief, the index tools lead to the customers and the section of the guide, which is read", () => {
  it("finds the domain and the section, names the tool of the guide, and reads it", async () => {
    const find = { id: "f1", name: "index_find", arguments: { words: "customer search" } };
    const entry = { id: "e1", name: "index_entry", arguments: { source: "shop-guide", item: "Customer search" } };
    const read = { id: "s1", name: "shop_guide_read_section", arguments: { number: 2 } };
    const { outcome, server } = await design(replies([[OPEN, find], [entry], [read], [PLAN], ...valid(3)]), { root: customersRepository(), plan: false, brief: "tester la recherche d'un client" });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.ok(requestText(server).includes("<brief>\\ntester la recherche d'un client\\n</brief>"));
    assert.match(toolResult(server, "f1"), /customers \(Customers\): The customers of the shop\./);
    assert.match(toolResult(server, "f1"), /shop-guide: Customer search/);
    assert.match(toolResult(server, "e1"), /Source shop-guide \(document\): read it with shop_guide_list_sections, shop_guide_read_section\./);
    assert.match(toolResult(server, "e1"), /Domains: customers\./);
    assert.match(toolResult(server, "s1"), /finds a customer by the start of their last name/);
    assert.equal(stateOf(outcome).brief, "tester la recherche d'un client");
  });
});

describe("the request of a brief", () => {
  it("holds what the index holds for the brief, what echoes most first, in place of the domains, and the domains when nothing echoes it", async () => {
    const { server } = await design(replies(valid(3)), { brief: "Follow the orders" });
    const request = requestText(server);
    assert.ok(request.includes("What the index holds for this brief:\\nDomains:\\n- orders (Orders): Placing and following an order.\\n- customers (Customers): The customers of the shop.\\nElements:\\n- shop-api: orders — Lists and places the orders of a customer. (operations)\\n- shop: /orders (screen)"), request);
    assert.ok(!request.includes("Domains of the index:"));
    const unknown = requestText((await design(replies(valid(3)), { brief: "zebra" })).server);
    assert.ok(unknown.includes("Domains of the index:\\n- orders (Orders)"));
  });
});

describe("brief, criterion 2 — without an accepted plan, run_test and propose_test are refused with a message that asks for the plan", () => {
  it("runs nothing, keeps nothing, and reminds the agent to submit the plan", async () => {
    const runner = new FakeTestRunner();
    const { outcome, server } = await design(replies([[run(spec("list-orders"), "r1"), close("c1")]]), { plan: false, runner });
    assert.equal(outcome.ok, false);
    assert.deepEqual(runner.runs, []);
    for (const id of ["r1", "c1"]) assert.equal(told(server, id), "Refused (PLAN-NONE): no plan is accepted yet. Call propose_plan first.\nNothing else was refused.");
    assert.match(messages(outcome), /The agent stopped without an accepted plan; it was reminded to submit one\./);
    const reminder = (server.requests[2]!.body as { messages: { role: string; content: string }[] }).messages.filter((message) => message.role === "user").at(-1)!.content;
    assert.ok(reminder.endsWith("\n\nYou stopped before the end. No plan is accepted yet.\nNext: read what the brief is about and do it once on the screens, then call propose_plan."), reminder);
  });
});

describe("brief, criterion 3 — the plan is written to the design state, and each test kept names its scenario", () => {
  it("keeps the plan, and the scenario of each test, in the order of the plan", async () => {
    const { outcome } = await design(replies(valid(3)));
    const state = stateOf(outcome);
    assert.deepEqual(state.plan, PLAN.arguments);
    assert.deepEqual(state.tests.map((test) => [test.path, test.scenario]), IDS.map((id) => [`apps/shop/${id}.spec.ts`, id]));
  });
});

describe("brief, criterion 4 — a review that refuses the plan stops the task, no test is written, and the journal says so", () => {
  it("creates no branch, writes nothing, refuses every later call, and reminds the agent of nothing", async () => {
    const review: PlanReview = { review: async () => ({ accepted: false, reason: "The scenarios check only screens." }) };
    const runner = new FakeTestRunner();
    const look = { id: "look", name: "shop_goto", arguments: { url: "/orders" } };
    const { outcome, root, server, before } = await design([{ body: toolCalls(MODEL, [PLAN, run(spec("x"), "r1")]) }, { body: toolCalls(MODEL, [{ ...PLAN, id: "plan-2" }, look]) }, { body: answer(MODEL, "Done.") }], { plan: false, planReview: review, runner });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.branch, undefined);
    // The trace of the session is all the design left.
    assert.deepEqual({ ...snapshot(root), status: "" }, { ...before, status: "" });
    assert.deepEqual(git(root, "status", "--porcelain", "--untracked-files=all").split("\n").filter((line) => !line.includes(".oqas/index/")), [`?? .oqas/traces/${outcome.tracePath!.split("/").at(-1)}`]);
    assert.deepEqual(runner.runs, []);
    assert.match(messages(outcome), /The plan was refused: The scenarios check only screens\. The design stops; no test is written\./);
    assert.match(messages(outcome), /No test was written: the plan was refused: The scenarios check only screens\./);
    for (const id of ["plan-2", "look"]) assert.match(toolResult(server, id), /The plan was refused: The scenarios check only screens\. The design is stopped; call no more tools\./);
    assert.equal(server.requests.length, 3);
  });
});

describe("the plan of a design", () => {
  it("refuses two scenarios of one id, then accepts the plan fixed, and no second plan", async () => {
    const twice = { id: "plan-twice", name: "propose_plan", arguments: { scenarios: ["list-orders", "list-orders", "follow-order"].map((id) => scenario(id)) } };
    const again = { ...PLAN, id: "plan-again" };
    const { outcome, server } = await design(replies([[OPEN, twice], [PLAN], [again], ...valid(3)]), { plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.equal(told(server, "plan-twice"), "Refused (PLAN-ID): the id list-orders is given to several scenarios. Give each scenario its own id.\nNothing else was refused.");
    assert.match(messages(outcome), /\[PLAN-ID\] The plan was refused by the harness: the id list-orders/);
    assert.match(toolResult(server, "plan-again"), /A plan was already accepted; carry it out\./);
    assert.match(messages(outcome), /The plan was accepted: list-orders, place-order, follow-order\./);
  });

  it("reminds an agent that stopped after a refused plan of the codes it was refused for", async () => {
    const twice = { id: "plan-twice", name: "propose_plan", arguments: { scenarios: ["list-orders", "list-orders", "follow-order"].map((id) => scenario(id)) } };
    const { server } = await design(replies([[twice]]), { plan: false });
    const reminder = (server.requests[2]!.body as { messages: { role: string; content: string }[] }).messages.filter((message) => message.role === "user").at(-1)!.content;
    assert.match(reminder, /\nYou stopped before the end\. The plan was last refused for: PLAN-ID\.\nNext: /);
  });
});

describe("plans submitted in one turn", () => {
  it("accept one plan only", async () => {
    const other = { id: "plan-other", name: "propose_plan", arguments: { scenarios: ["a-one", "a-two", "a-three"].map((id) => scenario(id)) } };
    const { outcome, server } = await design(replies([[OPEN, PLAN, other], ...valid(3)]), { plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.equal(outcome.journal.filter((entry) => entry.message.startsWith("The plan was accepted")).length, 1);
    assert.match(toolResult(server, "plan-other"), /A plan was already accepted; carry it out\./);
  });

  it("are refused once the review refused one of them", async () => {
    const review: PlanReview = { review: async () => ({ accepted: false, reason: "Not now." }) };
    const { outcome, server } = await design([{ body: toolCalls(MODEL, [PLAN, { ...PLAN, id: "plan-2" }]) }, { body: answer(MODEL, "Done.") }], { plan: false, planReview: review });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.journal.filter((entry) => entry.message.startsWith("The plan was refused: Not now.")).length, 1);
    assert.match(toolResult(server, "plan-2"), /The plan was refused: Not now\. The design is stopped/);
  });
});

describe("what a plan may hold", () => {
  it("refuses the value of a declared variable, the plan being written to the state, and cites a source the index does not list", async () => {
    const leaky = { id: "plan-leaky", name: "propose_plan", arguments: { scenarios: [scenario("list-orders", "other", { data: [{ value: USERNAME, from: "shop" }] }), scenario("place-order"), scenario("follow-order")] } };
    const beyond = { id: "plan-beyond", name: "propose_plan", arguments: { scenarios: [scenario("list-orders", "other", { sources: [{ source: "shop-db", item: "orders" }] }), scenario("place-order"), scenario("follow-order")] } };
    const { outcome, server } = await design(replies([[OPEN, leaky], [beyond], ...valid(3)]), { plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.match(toolResult(server, "plan-leaky"), /Refused \(PLAN-SECRET\): the plan holds the value of SHOP_USERNAME\. Leave it out; a test reads it with process\.env\.SHOP_USERNAME\./);
    assert.ok(!messages(outcome).includes(USERNAME));
    assert.deepEqual(stateOf(outcome).plan.scenarios[0]!.sources, [{ source: "shop-db", item: "orders" }]);
  });

  it("refuses a functional scenario none of whose texts an action of the agent made appear, and accepts it once the agent searched", async () => {
    const found = { result: "The order shows", shows: ["Order 42 of Ada"], absent: [] };
    const functional = (id: string, kase: string) => scenario(id, "functional", { case: kase, steps: [{ action: "Open the orders", expects: [] }, { action: "Search the orders", expects: [found] }] });
    const plan = (id: string) => ({ id, name: "propose_plan", arguments: { scenarios: [functional("list-orders", "nominal"), functional("place-order", "negative"), scenario("follow-order")] } });
    const { server } = await design(replies([[OPEN], [plan("seen")], [SEARCH], [plan("done")]]), { plan: false });
    assert.match(toolResult(server, "seen"), /Refused \(PLAN-RESULT\): no text scenario list-orders expects appeared, or went, after an action of yours on shop\. Do its steps with shop_fill and shop_click/);
    assert.match(toolResult(server, "search"), /Order 42 of Ada/);
    assert.match(told(server, "done"), /^The plan was accepted\./);
  });
});

describe("the screens a test relies on", () => {
  it("showed each locator of the test", async () => {
    const invented = spec("list-orders").replace('name: "Orders"', 'name: "Orders to deliver"');
    const far = spec("list-orders").replace("  });\n});", '    await page.getByTestId("zzqx").click();\n  });\n});');
    const { outcome, server } = await design(replies([[run(invented, "invented"), run(far, "far")], ...valid(3)]));
    assert.equal(outcome.ok, true, messages(outcome));
    assert.match(told(server, "invented"), /^Refused \(TEST-LOCATOR\): no screen you looked at showed getByRole\("heading", \{ name: "Orders to deliver" \}\)\.\nClosest elements you saw:\n- heading "Orders" \[level=1\]\n- textbox "Search orders" → [^\n]+\nCopy a locator as given, or take shop_snapshot at that step\.\nNothing else was refused\.$/);
    assert.match(told(server, "far"), /^Refused \(TEST-LOCATOR\): no screen you looked at showed getByTestId\("zzqx"\)\.\nCopy a locator as given/);
    // Opening the page gave the agent what it shows, each element with its locator.
    assert.match(toolResult(server, "open"), /heading .*Orders.*getByRole/);
  });
});

describe("the trace of a design", () => {
  const lines = (path: string) => readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { phase: string; actor: string; event: { type: string; outcome?: string; tool?: string; text?: string; message?: string } });

  it("holds the request, each call of the agent with its result, the journal, and ends as done", async () => {
    const seen: string[] = [];
    const { outcome } = await design(replies(valid(3)), { observe: (line) => seen.push(line.event.type) });
    const trace = lines(outcome.tracePath!);
    assert.ok(trace.every((line) => line.phase === "design"));
    assert.deepEqual([trace[0]!.event.type, trace.at(-1)!.event], ["started", { type: "finished", outcome: "done" }]);
    assert.match(trace.find((line) => line.event.type === "message")!.event.text!, /^Design Playwright tests for the environment local\./);
    assert.deepEqual(trace.filter((line) => line.actor === "agent" && line.event.type === "tool-call").map((line) => line.event.tool), ["shop_goto", "propose_plan", ...IDS.flatMap(() => ["run_test", "propose_test"])]);
    assert.ok(trace.some((line) => line.event.type === "journal" && line.event.message === "The scenario list-orders was closed: passed; its test is apps/shop/list-orders.spec.ts."));
    assert.equal(seen.length, trace.length);
    assert.ok(!readFileSync(outcome.tracePath!, "utf8").includes(PASSWORD));
  });

  it("ends as truncated when a limit cut a design that gave its tests, as failed otherwise, and is not opened without a session", async () => {
    const cut = await design([...valid(3).map((calls) => ({ body: toolCalls(MODEL, calls) })), { body: toolCalls(MODEL, [run(spec("late"), "late")]) }], { limits: { maxIterations: 7, maxDurationMinutes: 10, maxActions: 200 } });
    assert.equal(cut.outcome.ok, true, messages(cut.outcome));
    assert.equal(lines(cut.outcome.tracePath!).at(-1)!.event.outcome, "truncated");
    const few = await design(replies(valid(2)));
    assert.equal(lines(few.outcome.tracePath!).at(-1)!.event.outcome, "failed");
    const none = await design(replies([]));
    assert.equal(lines(none.outcome.tracePath!).at(-1)!.event.outcome, "failed");
    const dirty = repository();
    writeFileSync(join(dirty, "specs", "orders.md"), "changed\n");
    const stopped = await design(replies(valid(3)), { root: dirty });
    assert.equal(stopped.outcome.tracePath, undefined);
    assert.ok(!existsSync(join(dirty, ".oqas", "traces")));
  });
});
