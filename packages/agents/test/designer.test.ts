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

const spec = (title: string) =>
  `import { test, expect } from "@playwright/test";\n\ntest("${title}", async ({ page }) => {\n  await page.goto("/orders");\n  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();\n});\n`;

/** A call of `propose_test` for a test of the shop about orders. */
function propose(file: string, changes: Record<string, unknown> = {}): { id: string; name: string; arguments: unknown } {
  const content = (changes["content"] as string | undefined) ?? spec(file);
  // The assertion the test is kept for: its first expect, as written.
  const verifies = content.split("\n").find((line) => line.includes("expect("))?.trim() ?? "expect";
  return { id: `p-${file}-${Object.keys(changes).join("-")}`, name: "propose_test", arguments: { application: "shop", domain: "orders", scenario: "list-orders", verifies, file, reason: `Checks ${file}.`, content, ...changes } };
}

/** A scenario of the plan, about the orders of the shop. */
const scenario = (id: string, kind = "other") => ({ id, title: `The ${id} scenario`, intent: `Verifies ${id}.`, kind, expected: "The orders show.", sources: [{ source: "shop-api", item: "orders" }] });
/** A call that opens the orders page, which the designer must look at before it writes a test. */
const OPEN = { id: "open", name: "shop_goto", arguments: { url: "/orders" } };
/** A call that searches the orders, as a functional scenario needs the designer to have done. */
const SEARCH = { id: "search", name: "shop_click", arguments: { target: { role: "button", name: "Search" } } };
/** A call of `propose_plan` with three scenarios about the orders. */
const PLAN = { id: "plan", name: "propose_plan", arguments: { scenarios: ["list-orders", "place-order", "follow-order"].map((id) => scenario(id)) } };

const valid = (count: number) => Array.from({ length: count }, (_, i) => propose(`test-${i + 1}.spec.ts`));
/** A reply that makes the calls, then answers enough to end the task and every reminder. */
const replies = (calls: readonly ReturnType<typeof propose>[]) => [{ body: toolCalls(MODEL, calls) }, ...Array.from({ length: 4 }, () => ({ body: answer(MODEL, "Done.") }))];

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
    const failed = { id, verdict: "failed" as const, reason: "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('heading', { name: 'Orders' })", failedStep: "open the orders", trace: ".oqas/test-results/trace.zip" };
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

describe("criterion 1 — three valid tests are written on a new branch, in the folder of their application, with a state", () => {
  it("writes exactly three spec files and the state that lists them, commits them on the branch, and stays on it", async () => {
    const { outcome, root, server } = await design(replies(valid(3)));
    assert.equal(outcome.ok, true);
    assert.equal(git(root, "branch", "--show-current"), BRANCH);
    assert.deepEqual(filesOf(root).filter((path) => path.endsWith(".spec.ts")), ["apps/shop/test-1.spec.ts", "apps/shop/test-2.spec.ts", "apps/shop/test-3.spec.ts"]);
    assert.equal(readFileSync(join(root, "apps", "shop", "test-1.spec.ts"), "utf8"), spec("test-1.spec.ts"));
    const state = JSON.parse(readFileSync(outcome.statePath!, "utf8")) as DesignState;
    assert.equal(outcome.statePath, join(root, ".oqas", "designs", "design-20261113T100000Z.json"));
    assert.ok(filesOf(root).includes(".oqas/designs/design-20261113T100000Z.json"));
    assert.deepEqual(state.tests, [1, 2, 3].map((i) => ({ path: `apps/shop/test-${i}.spec.ts`, application: "shop", domain: "orders", scenario: "list-orders", verifies: 'await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();', reason: `Checks test-${i}.spec.ts.`, verdict: "passed" })));
    assert.deepEqual([state.plan, state.brief], [PLAN.arguments, undefined]);
    assert.deepEqual(outcome.tests, state.tests);
    assert.deepEqual([state.branch, state.base, state.environment, state.producedAt, state.model.model], [BRANCH, git(root, "rev-parse", "main"), "local", "2026-11-13T10:00:00.000Z", MODEL]);
    assert.deepEqual(git(root, "log", "-1", "--format=%an <%ae>%n%B", BRANCH).split("\n").slice(0, 3), ["Test Maintainer <maintainer@example.com>", "test: add 3 generated Playwright tests", ""]);
    assert.match(messages(outcome), /The design state was written to \.oqas\/designs\/design-20261113T100000Z\.json\.\nThe tests were committed on oqas\/design-test; the active branch of the test repository is oqas\/design-test\./);
    assert.equal(git(root, "status", "--porcelain", "--untracked-files=no"), "");
    assert.equal(server.requests.length, 3);
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
    const { outcome } = await design(replies([...valid(2), propose("last.spec.ts", { content: spec("last").trimEnd() })]), { root, branch: null });
    assert.match(outcome.branch!, /^oqas\/design-\d{8}T\d{6}Z$/);
    assert.equal(readFileSync(join(root, "apps", "shop", "last.spec.ts"), "utf8"), spec("last"));
    assert.ok(!filesOf(root, outcome.branch).some((path) => path.startsWith(".oqas/")));
    assert.ok(existsSync(outcome.statePath!));
    assert.match(messages(outcome), /which git ignores: it was not committed\./);
  });
});

describe("criterion 2 — of five valid tests, exactly four are written and the journal names the one set aside", () => {
  it("writes four when five proposals of one turn are checked at once", async () => {
    const slow: TestCheck = { check: () => new Promise((resolve) => setTimeout(() => resolve([]), 50)) };
    const { outcome, root } = await design(replies(valid(5)), { check: slow });
    assert.equal(outcome.tests.length, 4);
    assert.equal(filesOf(root).filter((path) => path.endsWith(".spec.ts")).length, 4);
    assert.match(messages(outcome), /was set aside: 4 tests were already accepted/);
  });

  it("writes the first four and journals the fifth", async () => {
    const { outcome, root } = await design(replies(valid(5)));
    assert.equal(outcome.ok, true);
    assert.equal(filesOf(root).filter((path) => path.endsWith(".spec.ts")).length, 4);
    assert.ok(!existsSync(join(root, "apps", "shop", "test-5.spec.ts")));
    assert.match(messages(outcome), /The test apps\/shop\/test-5\.spec\.ts was set aside: 4 tests were already accepted\./);
  });
});

describe("criterion 3 — with two valid tests the design fails, the journal says 2, and both files are on the branch", () => {
  it("reminds the agent, then keeps the two tests and fails", async () => {
    const { outcome, root } = await design(replies(valid(2)));
    assert.equal(outcome.ok, false);
    assert.match(messages(outcome), /The design failed: 2 tests were obtained, 3 at least are expected\./);
    assert.match(messages(outcome), /The agent stopped with fewer than 3 accepted tests \(2\); it was reminded to propose more\./);
    assert.deepEqual(filesOf(root).filter((path) => path.endsWith(".spec.ts")), ["apps/shop/test-1.spec.ts", "apps/shop/test-2.spec.ts"]);
  });

  it("writes nothing and creates no branch when no test was obtained, the session failing", async () => {
    const { outcome, root, before } = await design([{ status: 500, body: { error: { message: "down" } } }]);
    assert.equal(outcome.ok, false);
    assert.match(messages(outcome), /The session failed: .*\n[^]*No test was written: 0 tests were obtained/);
    assert.deepEqual(snapshot(root).branches, before.branches);
  });
});

describe("criterion 4 — a test that imports anything but @playwright/test or a relative path is not written, and the journal names the module", () => {
  it("refuses a platform package, a computed module, a path outside the repository and another test", async () => {
    const imports = (line: string) => `${line}\n${spec("imports")}`;
    const { outcome, root } = await design(
      replies([
        propose("platform.spec.ts", { content: imports(`import { Designer } from "@open-qa-stack/agents";`) }),
        propose("computed.spec.ts", { content: imports(`const helper = await import(process.env.HELPER!);`) }),
        propose("outside.spec.ts", { content: imports(`import { secret } from "../../../outside.ts";`) }),
        propose("chained.spec.ts", { content: imports(`import "./test-1.spec.ts";`) }),
        propose("helped.spec.ts", { content: imports(`import { openOrders } from "./helpers/orders.ts";`) }),
        ...valid(2),
      ]),
    );
    const journal = messages(outcome);
    assert.match(journal, /The test apps\/shop\/platform\.spec\.ts was refused: Line 1 imports @open-qa-stack\/agents; import only @playwright\/test/);
    assert.match(journal, /computed\.spec\.ts was refused: Line 1 imports a module whose name is computed/);
    assert.match(journal, /outside\.spec\.ts was refused: Line 1 imports \.\.\/\.\.\/\.\.\/outside\.ts, outside the test repository\./);
    assert.match(journal, /chained\.spec\.ts was refused: Line 1 imports \.\/test-1\.spec\.ts, another test file/);
    const written = filesOf(root).filter((path) => path.endsWith(".spec.ts"));
    assert.deepEqual(written, ["apps/shop/helped.spec.ts", "apps/shop/test-1.spec.ts", "apps/shop/test-2.spec.ts"]);
  });
});

describe("criterion 5 — a test that does not parse as TypeScript is not written, and the journal holds the parse error", () => {
  it("refuses it with the line and column of the error", async () => {
    const { outcome, root } = await design(replies([propose("broken.spec.ts", { content: `import { test } from "@playwright/test";\ntest("x", async () => {\n` }), ...valid(3)]));
    assert.match(messages(outcome), /The test apps\/shop\/broken\.spec\.ts was refused: The test does not parse as TypeScript: line \d+, column \d+: (missing|unexpected) /);
    assert.ok(!filesOf(root).includes("apps/shop/broken.spec.ts"));
    assert.equal(outcome.ok, true);
  });
});

describe("criterion 6 — a test that holds a declared address or the value of an account variable is not written", () => {
  it("refuses an address, a host, a username and a password, and masks the values in the journal", async () => {
    const { outcome, root, server } = await design(
      replies([
        propose("address.spec.ts", { content: spec("x").replace(`"/orders"`, `"${site.origin}/orders"`) }),
        propose("host.spec.ts", { content: spec("x").replace(`"/orders"`, `"//ledger.test:8100/orders"`) }),
        propose("login.spec.ts", { content: spec("x").replace(`"/orders"`, `"/login?user=${encodeURIComponent(USERNAME)}"`), reason: `Signs in with ${PASSWORD}.` }),
        propose("leaky.spec.ts", { content: `const password = "${PASSWORD}";\ntest("x", async () => {\n` }),
        ...valid(3),
      ]),
    );
    const journal = messages(outcome);
    assert.match(journal, new RegExp(`address\\.spec\\.ts was refused: The test holds ${site.origin.replaceAll(".", "\\.")}, an address of the configuration`));
    assert.match(journal, /host\.spec\.ts was refused: The test holds ledger\.test:8100, an address of the configuration/);
    assert.match(journal, /login\.spec\.ts was refused: The proposal holds the value of SHOP_USERNAME; read it with process\.env\.SHOP_USERNAME instead\./);
    assert.match(journal, /login\.spec\.ts was refused: The proposal holds the value of SHOP_PASSWORD/);
    for (const path of ["address", "host", "login", "leaky"]) assert.ok(!filesOf(root).includes(`apps/shop/${path}.spec.ts`));
    const told = server.requests.flatMap((request) => (request.body as { messages: { role: string; content: unknown }[] }).messages.filter((message) => message.role === "tool"));
    const traces = [journal, JSON.stringify(told)].join("\n");
    assert.match(journal, /leaky\.spec\.ts was refused: The test does not parse as TypeScript: line 1, column 1: unexpected "const password = \\"\[secret\]\\";"/);
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
    for (const calls of [valid(3), valid(1)]) {
      const { root, before } = await design(replies(calls));
      assert.equal(snapshot(root).remote, before.remote);
    }
    const root = repository();
    git(root, "branch", BRANCH);
    const stopped = await design(replies(valid(3)), { root });
    assert.equal(snapshot(root).remote, stopped.before.remote);
  });
});

describe("criterion 9 — past the action limit the task is cut, the journal says so, and the proposal under way is not written", () => {
  it("writes the test accepted before the cut, not the one proposed after the 201st action", async () => {
    const actions = Array.from({ length: 201 }, (_, i) => ({ id: `g${i}`, name: "shop_goto", arguments: { url: "/" } }));
    const { outcome, root } = await design([{ body: toolCalls(MODEL, [propose("first.spec.ts")]) }, { body: toolCalls(MODEL, [...actions, propose("late.spec.ts")]) }, { body: answer(MODEL, "Done.") }]);
    assert.match(messages(outcome), /The task reached its actions limit; no test was written for the proposal under way\./);
    assert.deepEqual(filesOf(root).filter((path) => path.endsWith(".spec.ts")), ["apps/shop/first.spec.ts"]);
    assert.match(messages(outcome), /The design failed: 1 test was obtained, 3 at least are expected\./);
  });
});

describe("criterion 10 — no generated test imports another, and nothing is written in the journeys or the blocks", () => {
  it("holds for three, five and two proposals", async () => {
    for (const count of [3, 5, 2]) {
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
    const imported = files.flatMap((file) => [...readFileSync(new URL(file, folder), "utf8").matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]!));
    const allowed = (module: string) => module.startsWith("node:") || module.startsWith(".") || ["@open-qa-stack/domain", "@open-qa-stack/shared", "@open-qa-stack/tools"].includes(module);
    assert.ok(files.some((file) => file.startsWith("designer")));
    assert.deepEqual(imported.filter((module) => !allowed(module)), []);
  });
});

describe("guiding the designer", () => {
  it("refuses a taken file name, a domain the index lacks, and a test the check finds fault with", async () => {
    const check: TestCheck = {
      check: async (proposed) =>
        proposed.path.endsWith("waits.spec.ts")
          ? [
              { kind: "charter", rule: "PW-WAIT-01", line: 4, column: 9, message: "Wait for a state, never for a fixed time.", example: 'await expect(page.getByRole("table")).toBeVisible();' },
              { kind: "charter", rule: "TEAM-TAG-01", line: 1, column: 1, message: "Tag the test." },
              { kind: "compiler", code: "TS2304", line: 2, column: 1, message: "Cannot find name 'testInfo'." },
            ]
          : [],
    };
    const root = repository();
    const { outcome } = await design(replies([propose("test-1.spec.ts"), propose("test-1.spec.ts"), propose("specs.spec.ts", { domain: "returns" }), propose("waits.spec.ts"), ...valid(3).slice(1)]), { root, check });
    const journal = messages(outcome);
    assert.match(journal, /apps\/shop\/test-1\.spec\.ts was refused: apps\/shop\/test-1\.spec\.ts is already taken/);
    assert.match(journal, /propose_test: .*domain/);
    assert.match(journal, /waits\.spec\.ts was refused: Line 4, column 9 \(rule PW-WAIT-01\): Wait for a state, never for a fixed time\. Example: await expect\(page\.getByRole\("table"\)\)\.toBeVisible\(\);\n/);
    assert.match(journal, /waits\.spec\.ts was refused: Line 1, column 1 \(rule TEAM-TAG-01\): Tag the test\.\n/);
    assert.match(journal, /waits\.spec\.ts was refused: Line 2, column 1 \(compiler TS2304\): Cannot find name 'testInfo'\./);
    assert.equal(outcome.tests.length, 3);
  });

  it("refuses a file that already exists in the test repository", async () => {
    const root = repository();
    mkdirSync(join(root, "apps", "shop"), { recursive: true });
    writeFileSync(join(root, "apps", "shop", "test-1.spec.ts"), "// kept\n");
    git(root, "add", "-A", "apps");
    git(root, "commit", "-q", "-m", "test: keep a test");
    const { outcome } = await design(replies(valid(4)), { root });
    assert.match(messages(outcome), /test-1\.spec\.ts is already taken/);
    assert.equal(readFileSync(join(root, "apps", "shop", "test-1.spec.ts"), "utf8"), "// kept\n");
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

/** A call of `run_test` for a test of the shop. */
const tryTest = (file: string, content: string, id: string) => ({ id, name: "run_test", arguments: { application: "shop", scenario: "list-orders", file, content } });
const broken = (file: string) => `${spec(file)}// BROKEN\n`;
/** The text of the result of a tool call, as the next request gives it to the model. */
const toolResult = (server: ScriptedServer, callId: string) => {
  for (const request of server.requests) {
    const found = (request.body as { messages: { role: string; tool_call_id?: string; content?: unknown }[] }).messages.find((message) => message.role === "tool" && message.tool_call_id === callId);
    if (found !== undefined) return JSON.stringify(found.content);
  }
  return "";
};

describe("loop, criterion 1 — a test that fails, then is fixed, is run twice and passes", () => {
  it("runs the broken text, then the fixed one, and keeps the test as passed", async () => {
    const runner = new FakeTestRunner();
    const turns = [[tryTest("test-1.spec.ts", broken("test-1.spec.ts"), "r1")], [tryTest("test-1.spec.ts", spec("test-1.spec.ts"), "r2")], valid(3)];
    const { outcome } = await design([...turns.map((calls) => ({ body: toolCalls(MODEL, calls) })), ...replies([]).slice(1)], { runner });
    assert.deepEqual(runner.runs.filter((run) => run.path === "apps/shop/test-1.spec.ts").map((run) => run.content.includes("BROKEN")), [true, false]);
    assert.equal(outcome.tests.find((test) => test.path === "apps/shop/test-1.spec.ts")?.verdict, "passed");
    assert.equal(runner.runs.length, 4, "a text already tried is not run again when it is proposed");
    assert.match(messages(outcome), /The test apps\/shop\/test-1\.spec\.ts was run: failed\.\nThe test apps\/shop\/test-1\.spec\.ts was run: passed\./);
  });
});

describe("loop, criterion 2 — the result told to the agent holds the assertion, the failed step and the trace", () => {
  it("gives the error in full, the step, the trace and the instant to read the logs from", async () => {
    const call = tryTest("test-1.spec.ts", broken("test-1.spec.ts"), "r1");
    const { server } = await design(replies([call, ...valid(3)]));
    const told = toolResult(server, "r1");
    for (const part of ["Run of the file: failed.", "expect(locator).toBeVisible() failed", "getByRole('heading', { name: 'Orders' })", "Failed step: open the orders", "Trace: .oqas/test-results/trace.zip", "since 2026-11-13T10:00:00.000Z"]) assert.ok(told.includes(part), part);
  });

  it("refuses to run a test the rules refuse, and tells why when a test cannot run", async () => {
    const runner = new FakeTestRunner();
    const outside = tryTest("test-1.spec.ts", `import fs from "node:fs";\n${spec("test-1.spec.ts")}`, "r1");
    const { server } = await design(replies([outside, ...valid(3)]), { runner });
    assert.match(toolResult(server, "r1"), /could not be run/);
    assert.ok(runner.runs.every((run) => !run.content.includes("node:fs")));
    const failing = new FakeTestRunner("The browsers of Playwright 1.64.1 could not be installed: offline");
    const cannot = await design(replies([tryTest("test-1.spec.ts", spec("test-1.spec.ts"), "r2"), ...valid(3)]), { runner: failing });
    assert.match(toolResult(cannot.server, "r2"), /could not be run[^"]*offline/);
    assert.equal(cannot.outcome.tests.length, 0);
    assert.match(messages(cannot.outcome), /test-1\.spec\.ts was refused: The test could not run: The browsers/);
  });
});

describe("loop, criterion 3 — the trials count against the limits, and a test not fixed is never kept as passed", () => {
  it("stops at the limit of iterations, and keeps no test that did not pass", async () => {
    const trials = Array.from({ length: 6 }, (_, i) => ({ body: toolCalls(MODEL, [tryTest("test-1.spec.ts", `${broken("test-1.spec.ts")}// ${i}\n`, `r${i}`)]) }));
    const { outcome } = await design([...trials, { body: answer(MODEL, "Done.") }], { limits: { maxIterations: 3, maxDurationMinutes: 10, maxActions: 200 } });
    assert.match(messages(outcome), /The task reached its iterations limit/);
    assert.deepEqual(outcome.tests, []);
    assert.equal(outcome.ok, false);
  });

  it("refuses a proposal that does not pass, with what the run gave, when the agent says nothing of the application", async () => {
    const { outcome, server } = await design(replies([propose("test-1.spec.ts", { content: broken("test-1.spec.ts") }), ...valid(3)]));
    assert.match(messages(outcome), /test-1\.spec\.ts was refused: It does not pass\. Fix it, or, if the application is at fault/);
    assert.ok(outcome.tests.every((test) => test.verdict === "passed"));
    assert.ok(toolResult(server, "p-test-1.spec.ts-content").includes("Failed step: open the orders"));
  });
});

describe("loop, criterion 4 — a failure blamed on the application is kept with its explanation and the harness's verdict", () => {
  it("writes the test with its verdict failed and the explanation in the state", async () => {
    const blamed = propose("test-4.spec.ts", { content: broken("test-4.spec.ts"), failure: "The total stays empty although the order has two lines: the service returns no total." });
    const turns = [[tryTest("test-4.spec.ts", broken("test-4.spec.ts"), "r4")], [...valid(3), blamed]];
    const { outcome, root } = await design([...turns.map((calls) => ({ body: toolCalls(MODEL, calls) })), ...replies([]).slice(1)]);
    const test = outcome.tests.find((candidate) => candidate.path === "apps/shop/test-4.spec.ts");
    assert.deepEqual([test?.verdict, test?.failure], ["failed", "The total stays empty although the order has two lines: the service returns no total."]);
    const state = JSON.parse(readFileSync(outcome.statePath!, "utf8")) as DesignState;
    assert.equal(state.tests.find((candidate) => candidate.path === "apps/shop/test-4.spec.ts")?.verdict, "failed");
    assert.ok(filesOf(root).includes("apps/shop/test-4.spec.ts"));
  });
});

describe("what a trial tells the agent", () => {
  it("cuts a long error, and counts a file whose run gives no test as not run", async () => {
    const long: TestRunner = { run: async (test) => ({ startedAt: "2026-11-13T10:00:00.000Z", tests: [{ id: `shop › ${test.path} › t`, verdict: "failed", reason: "x".repeat(5000) }] }) };
    const cut = await design(replies([tryTest("test-1.spec.ts", spec("test-1.spec.ts"), "r1"), ...valid(3)]), { runner: long as FakeTestRunner });
    const told = toolResult(cut.server, "r1");
    assert.ok(told.includes(`${"x".repeat(4000)}…`) && !told.includes("x".repeat(4001)) && !told.includes("Failed step"));
    const empty: TestRunner = { run: async () => ({ startedAt: "2026-11-13T10:00:00.000Z", tests: [] }) };
    const none = await design(replies([tryTest("test-1.spec.ts", spec("test-1.spec.ts"), "r1"), ...valid(3)]), { runner: empty as FakeTestRunner });
    assert.match(toolResult(none.server, "r1"), /Run of the file: not_run\./);
    assert.deepEqual(none.outcome.tests, []);
  });
});

describe("what the designer may keep", () => {
  const turns = (...calls: ReturnType<typeof propose>[][]) => [...calls.map((call) => ({ body: toolCalls(MODEL, call) })), ...replies([]).slice(1)];

  it("refuses a failure blamed on the application for a text the agent never saw run, and keeps a passing test as passed whatever it claims", async () => {
    const blind = propose("test-4.spec.ts", { content: broken("test-4.spec.ts"), failure: "The service returns no total." });
    const claimed = propose("test-5.spec.ts", { failure: "The service returns no total." });
    const { outcome } = await design(replies([...valid(2), blind, claimed]));
    assert.match(messages(outcome), /test-4\.spec\.ts was refused: It does not pass\. Fix it, or, if the application is at fault, run it with run_test/);
    const kept = outcome.tests.find((test) => test.path === "apps/shop/test-5.spec.ts");
    assert.deepEqual([kept?.verdict, kept !== undefined && "failure" in kept], ["passed", false]);
  });

  it("never keeps a test that did not run to a verdict, even with a failure", async () => {
    for (const verdict of ["skipped", "blocked"] as const) {
      const runner: TestRunner = { run: async (test) => ({ startedAt: "2026-11-13T10:00:00.000Z", tests: [{ id: `shop › ${test.path} › t`, verdict, reason: "x" }] }) };
      const { outcome } = await design(turns([tryTest("test-1.spec.ts", spec("test-1.spec.ts"), "r1")], [propose("test-1.spec.ts", { failure: "The application is down." })]), { runner: runner as FakeTestRunner });
      assert.deepEqual(outcome.tests, [], verdict);
      assert.match(messages(outcome), new RegExp(`did not run to a verdict \\(${verdict}\\)`));
    }
  });

  it("keeps one test of two proposed at once at the same path", async () => {
    const slow: TestRunner = { run: (test) => new Promise((resolve) => setTimeout(() => resolve({ startedAt: "2026-11-13T10:00:00.000Z", tests: [{ id: `shop › ${test.path} › t`, verdict: "passed", reason: "ok" }] }), 50)) };
    const { outcome } = await design(replies([propose("test-1.spec.ts"), propose("test-1.spec.ts", { reason: "Another." }), propose("test-2.spec.ts"), propose("test-3.spec.ts")]), { runner: slow as FakeTestRunner });
    assert.equal(outcome.tests.filter((test) => test.path === "apps/shop/test-1.spec.ts").length, 1);
  });

  it("refuses a test that writes a file, without running it", async () => {
    const runner = new FakeTestRunner();
    const writes = spec("test-1.spec.ts").replace("});\n", "  await page.screenshot({ path: \"/tmp/x.png\" });\n});\n");
    const { outcome } = await design(replies([tryTest("test-1.spec.ts", writes, "r1"), propose("test-9.spec.ts", { content: writes }), ...valid(3)]), { runner });
    assert.match(messages(outcome), /test-1\.spec\.ts could not be run: The test writes a file/);
    assert.match(messages(outcome), /test-9\.spec\.ts was refused: The test writes a file/);
    assert.ok(runner.runs.every((run) => !run.content.includes("screenshot")));
  });

  it("gives the verdict and the failure of a test that does not pass in the commit message", async () => {
    const blamed = propose("test-4.spec.ts", { content: broken("test-4.spec.ts"), failure: "The service returns no total." });
    const { root } = await design(turns([tryTest("test-4.spec.ts", broken("test-4.spec.ts"), "r4")], [...valid(3), blamed]));
    assert.match(git(root, "log", "-1", "--format=%B", BRANCH), /- apps\/shop\/test-4\.spec\.ts \(failed\): Checks test-4\.spec\.ts\. Failure: The service returns no total\./);
  });
});

describe("a visual test", () => {
  it("is run and kept: it opens a page and compares a full capture with its reference", async () => {
    const runner = new FakeTestRunner();
    const visual = `import { test, expect } from "@playwright/test";\n\ntest("the list of orders looks as it should", async ({ page }) => {\n  await page.goto("/orders");\n  await expect(page).toHaveScreenshot({ fullPage: true });\n});\n`;
    const { outcome } = await design(replies([propose("orders-look.spec.ts", { content: visual }), ...valid(2)]), { runner });
    assert.equal(outcome.tests.find((test) => test.path === "apps/shop/orders-look.spec.ts")?.verdict, "passed", messages(outcome));
    assert.ok(runner.runs.some((run) => run.content === visual));
  });
});

describe("the packages a test may import", () => {
  it("are those the package.json of the test repository declares, and @playwright/test without one", () => {
    assert.deepEqual(testPackages(JSON.stringify({ dependencies: { "@axe-core/playwright": "4.11.0" }, devDependencies: { "@playwright/test": "1.64.1", "@axe-core/playwright": "4.11.0" } })), ["@axe-core/playwright", "@playwright/test"]);
    for (const manifest of [undefined, "{ not json", "null", "{}", JSON.stringify({ dependencies: "x", devDependencies: null })]) assert.deepEqual(testPackages(manifest), ["@playwright/test"], String(manifest));
  });

  it("let an accessibility test import axe-core when the test repository declares it, and refuse a package it does not", async () => {
    const manifest = JSON.stringify({ devDependencies: { "@playwright/test": "1.64.1", "@axe-core/playwright": "4.11.0" } });
    const a11y = `import { test, expect } from "@playwright/test";\nimport AxeBuilder from "@axe-core/playwright";\n\ntest("the orders have no accessibility violation", async ({ page }) => {\n  await page.goto("/orders");\n  const results = await new AxeBuilder({ page }).analyze();\n  expect(results.violations).toEqual([]);\n});\n`;
    const other = spec("test-9.spec.ts").replace('from "@playwright/test";', 'from "@playwright/test";\nimport { faker } from "@faker-js/faker";');
    const { outcome, server } = await design(replies([propose("orders-a11y.spec.ts", { content: a11y }), propose("test-9.spec.ts", { content: other }), ...valid(2)]), { root: repository(INDEX, manifest) });
    assert.equal(outcome.tests.find((test) => test.path === "apps/shop/orders-a11y.spec.ts")?.verdict, "passed", messages(outcome));
    assert.match(messages(outcome), /test-9\.spec\.ts was refused: Line 2 imports @faker-js\/faker; import only @playwright\/test, @axe-core\/playwright or a relative path/);
    assert.match(JSON.stringify(server.requests[0]!.body), /Import only the packages of the test repository \(@playwright\/test, @axe-core\/playwright\)/);
  });
});

describe("the references of a visual test", () => {
  it("are written and committed with the test, and listed in the state", async () => {
    const reference = { path: "apps/shop/orders-look.spec.ts-snapshots/orders-look-1-shop.png", content: new Uint8Array([137, 80, 78, 71]) };
    const runner: TestRunner = { run: async (test) => ({ startedAt: "2026-11-13T10:00:00.000Z", tests: [{ id: `shop › ${test.path} › t`, verdict: "passed", reason: "ok" }], ...(test.path.endsWith("orders-look.spec.ts") ? { references: [reference] } : {}) }) };
    const { outcome, root } = await design(replies([propose("orders-look.spec.ts"), ...valid(2)]), { runner: runner as FakeTestRunner });
    assert.ok(filesOf(root).includes(reference.path));
    assert.deepEqual([...readFileSync(join(root, reference.path))], [137, 80, 78, 71]);
    assert.deepEqual(outcome.tests.find((test) => test.path === "apps/shop/orders-look.spec.ts")?.references, [reference.path]);
    assert.ok(outcome.tests.filter((test) => test.path !== "apps/shop/orders-look.spec.ts").every((test) => !("references" in test)));
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
    const { outcome, server } = await design([{ body: toolCalls(MODEL, [OPEN, find]) }, { body: toolCalls(MODEL, [entry]) }, { body: toolCalls(MODEL, [read]) }, { body: toolCalls(MODEL, [PLAN]) }, ...replies(valid(3))], { root: customersRepository(), plan: false, brief: "tester la recherche d'un client" });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.ok(requestText(server).includes("<brief>\\ntester la recherche d'un client\\n</brief>"));
    assert.match(toolResult(server, "f1"), /customers \(Customers\): The customers of the shop\./);
    assert.match(toolResult(server, "f1"), /shop-guide: Customer search/);
    assert.match(toolResult(server, "e1"), /Source shop-guide \(document\): read it with shop_guide_list_sections, shop_guide_read_section\./);
    assert.match(toolResult(server, "e1"), /Domains: customers\./);
    assert.match(toolResult(server, "s1"), /finds a customer by the start of their last name/);
    const state = JSON.parse(readFileSync(outcome.statePath!, "utf8")) as DesignState;
    assert.equal(state.brief, "tester la recherche d'un client");
  });
});

describe("brief, criterion 2 — without an accepted plan, run_test and propose_test are refused with a message that asks for the plan", () => {
  it("runs nothing, keeps nothing, and reminds the agent to submit the plan", async () => {
    const runner = new FakeTestRunner();
    const { outcome, server } = await design([{ body: toolCalls(MODEL, [tryTest("test-1.spec.ts", spec("test-1.spec.ts"), "r1"), propose("test-1.spec.ts")]) }, ...replies([])], { plan: false, runner });
    assert.equal(outcome.ok, false);
    assert.deepEqual(runner.runs, []);
    for (const id of ["r1", propose("test-1.spec.ts").id]) assert.match(toolResult(server, id), /No test plan is accepted yet\. Submit the plan with propose_plan first/);
    assert.match(messages(outcome), /The agent stopped without an accepted plan; it was reminded to submit one\./);
  });
});

describe("brief, criterion 3 — the plan is written to the design state, and each test kept names its scenario", () => {
  it("keeps the plan, the scenario of each test, and refuses a test of a scenario the plan does not hold", async () => {
    const calls = [propose("test-1.spec.ts"), propose("test-2.spec.ts", { scenario: "place-order" }), propose("test-9.spec.ts", { scenario: "return-order" }), propose("test-3.spec.ts", { scenario: "follow-order" })];
    const { outcome } = await design(replies(calls));
    const state = JSON.parse(readFileSync(outcome.statePath!, "utf8")) as DesignState;
    assert.deepEqual(state.plan, PLAN.arguments);
    assert.deepEqual(state.tests.map((test) => [test.path, test.scenario]), [["apps/shop/test-1.spec.ts", "list-orders"], ["apps/shop/test-2.spec.ts", "place-order"], ["apps/shop/test-3.spec.ts", "follow-order"]]);
    assert.match(messages(outcome), /return-order is no scenario of the accepted plan; the scenarios are list-orders, place-order, follow-order\./);
  });
});

describe("brief, criterion 4 — a review that refuses the plan stops the task, no test is written, and the journal says so", () => {
  it("creates no branch, writes nothing, refuses every later call, and reminds the agent of nothing", async () => {
    const review: PlanReview = { review: async () => ({ accepted: false, reason: "The scenarios check only screens." }) };
    const runner = new FakeTestRunner();
    const look = { id: "look", name: "shop_goto", arguments: { url: "/orders" } };
    const { outcome, root, server, before } = await design([{ body: toolCalls(MODEL, [PLAN, ...valid(3)]) }, { body: toolCalls(MODEL, [{ ...PLAN, id: "plan-2" }, look]) }, { body: answer(MODEL, "Done.") }], { plan: false, planReview: review, runner });
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
    const { outcome, server } = await design([{ body: toolCalls(MODEL, [OPEN, twice]) }, { body: toolCalls(MODEL, [PLAN]) }, { body: toolCalls(MODEL, [again]) }, ...replies(valid(3))], { plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.match(toolResult(server, "plan-twice"), /The id list-orders is given to several scenarios; give each its own\./);
    assert.match(toolResult(server, "plan-again"), /A plan was already accepted; carry it out\./);
    assert.match(messages(outcome), /The plan was accepted: list-orders, place-order, follow-order\./);
  });
});

describe("plans submitted in one turn", () => {
  it("accept one plan only", async () => {
    const other = { id: "plan-other", name: "propose_plan", arguments: { scenarios: ["a-one", "a-two", "a-three"].map((id) => scenario(id)) } };
    const { outcome, server } = await design([{ body: toolCalls(MODEL, [OPEN, PLAN, other]) }, ...replies(valid(3))], { plan: false });
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
    const leaky = { id: "plan-leaky", name: "propose_plan", arguments: { scenarios: [{ ...scenario("list-orders"), expected: `The orders of ${USERNAME} show.` }, scenario("place-order"), scenario("follow-order")] } };
    const beyond = { id: "plan-beyond", name: "propose_plan", arguments: { scenarios: [{ ...scenario("list-orders"), sources: [{ source: "shop-db", item: "orders" }] }, scenario("place-order"), scenario("follow-order")] } };
    const { outcome, server } = await design([{ body: toolCalls(MODEL, [OPEN, leaky]) }, { body: toolCalls(MODEL, [beyond]) }, ...replies(valid(3))], { plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.match(toolResult(server, "plan-leaky"), /The plan holds the value of SHOP_USERNAME; leave it out: the plan is written to the design state\./);
    assert.ok(!messages(outcome).includes(USERNAME));
    const state = JSON.parse(readFileSync(outcome.statePath!, "utf8")) as DesignState;
    assert.deepEqual(state.plan.scenarios[0]!.sources, [{ source: "shop-db", item: "orders" }]);
  });
});

describe("the assertion a test is kept for", () => {
  it("must be an expect copied from the test, spaces and quotes aside", async () => {
    const elsewhere = propose("test-8.spec.ts", { verifies: "await expect(page).toHaveTitle('Shop');" });
    const vague = propose("test-9.spec.ts", { verifies: "the heading shows" });
    // The same assertion, with other spaces, other quotes and no semicolon.
    const spaced = propose("test-1.spec.ts", { verifies: "await expect(page.getByRole('heading',{name:`Orders`}))\n  .toBeVisible()" });
    const { outcome, server } = await design(replies([elsewhere, vague, spaced, ...valid(3).slice(1)]));
    assert.equal(outcome.ok, true, messages(outcome));
    for (const call of [elsewhere, vague]) assert.match(toolResult(server, call.id), /verifies must copy, as written in the test, the expect assertion that verifies the expected result of its scenario\./);
    assert.deepEqual(outcome.tests.map((test) => test.path), ["apps/shop/test-1.spec.ts", "apps/shop/test-2.spec.ts", "apps/shop/test-3.spec.ts"]);
  });
});

describe("the assertion of a functional scenario", () => {
  const heading = 'await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();';
  const found = 'await expect(page.getByText("Order 42 of Ada")).toBeVisible();';
  const search = 'await page.getByRole("button", { name: "Search" }).click();';
  const test = (...lines: string[]) => `import { test, expect } from "@playwright/test";\n\ntest("orders", async ({ page }) => {\n  await page.goto("/orders");\n${lines.map((line) => `  ${line}\n`).join("")}});\n`;
  const plan = { id: "plan-kinds", name: "propose_plan", arguments: { scenarios: [scenario("list-orders", "functional"), scenario("place-order"), scenario("look", "visual")] } };

  it("must follow an action, repeat no earlier check and name what the action produced; another kind of scenario needs none of it", async () => {
    const before = `import { test, expect } from "@playwright/test";\n\ntest("before", async ({ page }) => {\n  ${heading}\n  await page.goto("/orders");\n});\n`;
    const calls = [
      propose("test-6.spec.ts", { content: before, verifies: heading }),
      propose("test-7.spec.ts", { content: test(heading, search, heading), verifies: heading }),
      propose("test-8.spec.ts", { content: test(search, heading), verifies: heading }),
      propose("test-9.spec.ts", { content: test(search, found), verifies: found }),
      propose("test-5.spec.ts", { content: before, verifies: heading, scenario: "look" }),
      propose("test-4.spec.ts", { scenario: "place-order" }),
    ];
    const { outcome, server } = await design([{ body: toolCalls(MODEL, [OPEN, plan]) }, { body: toolCalls(MODEL, [SEARCH]) }, ...replies(calls)], { plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    for (const call of calls.slice(0, 2)) assert.match(toolResult(server, call.id), /In a functional scenario, the assertion of verifies checks what an action produced: it comes after a goto, a click, a fill or a request, and repeats no check made before\./);
    assert.match(toolResult(server, calls[2]!.id), /What verifies names was already on the page before the action: it verifies nothing of the scenario\./);
    assert.deepEqual(outcome.tests.map((kept) => [kept.path, kept.scenario]), [["apps/shop/test-9.spec.ts", "list-orders"], ["apps/shop/test-5.spec.ts", "look"], ["apps/shop/test-4.spec.ts", "place-order"]]);
    assert.match(toolResult(server, "plan-kinds"), /do its steps with the browser tools and see what the screen shows after each action/);
    // The click told the agent what it produced.
    assert.match(toolResult(server, "search"), /Order 42 of Ada/);
  });

  it("is not run before the agent did the steps itself", async () => {
    const runner = new FakeTestRunner();
    const first = { ...tryTest("test-9.spec.ts", test(search, found), "r1") };
    const { outcome, server } = await design([{ body: toolCalls(MODEL, [OPEN, plan]) }, { body: toolCalls(MODEL, [first]) }, { body: toolCalls(MODEL, [SEARCH]) }, { body: toolCalls(MODEL, [{ ...first, id: "r2" }]) }, ...replies([])], { plan: false, runner });
    assert.match(toolResult(server, "r1"), /You have not done the steps of the scenario yourself yet\. Do them with shop_fill and shop_click, read what appears, then write the test from what you saw\./);
    assert.match(toolResult(server, "r2"), /Run of the file: passed\./);
    assert.equal(runner.runs.length, 1);
    assert.equal(outcome.ok, false);
  });
});

describe("the screens a test relies on", () => {
  it("must have been looked at, and showed each locator of the test", async () => {
    const invented = spec("test-8.spec.ts").replace('name: "Orders"', 'name: "Deliveries"');
    const blind = tryTest("test-1.spec.ts", spec("test-1.spec.ts"), "blind");
    const { outcome, server } = await design([{ body: toolCalls(MODEL, [PLAN]) }, { body: toolCalls(MODEL, [blind]) }, { body: toolCalls(MODEL, [OPEN]) }, ...replies([propose("test-8.spec.ts", { content: invented }), ...valid(3)])], { plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.match(toolResult(server, "blind"), /You have not looked at the screens of shop yet\. Open the page of the scenario with shop_goto and read what it shows before you write its test\./);
    assert.match(toolResult(server, "p-test-8.spec.ts-content"), /No screen you looked at showed getByRole\(.*heading.*Deliveries.*\)\. Use only locators the snapshots gave, copied as given/);
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
    assert.deepEqual(trace.filter((line) => line.actor === "agent" && line.event.type === "tool-call").map((line) => line.event.tool), ["shop_goto", "propose_plan", "propose_test", "propose_test", "propose_test"]);
    assert.ok(trace.some((line) => line.event.type === "journal" && line.event.message === "The test apps/shop/test-1.spec.ts was accepted."));
    assert.equal(seen.length, trace.length);
    assert.ok(!readFileSync(outcome.tracePath!, "utf8").includes(PASSWORD));
  });

  it("ends as truncated when a limit cut a design that gave its tests, as failed otherwise, and is not opened without a session", async () => {
    const cut = await design([{ body: toolCalls(MODEL, valid(3)) }, { body: toolCalls(MODEL, [propose("late.spec.ts")]) }], { limits: { maxIterations: 3, maxDurationMinutes: 10, maxActions: 200 } });
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
