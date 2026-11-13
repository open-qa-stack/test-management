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
import type { TestCheck } from "@open-qa-stack/domain";
import { Designer, type DesignOutcome, type DesignState } from "../src/index.ts";

const MODEL = "test-model";
const BRANCH = "oqas/design-test";
const USERNAME = "ada.lovelace@example.com";
const PASSWORD = "Tr0ub4dor&3";
const ENV = { SHOP_USERNAME: USERNAME, SHOP_PASSWORD: PASSWORD, SHOP_DB_URL: "postgresql://shop:s3cret-db-pass@127.0.0.1:5999/shop" };

let site: TestSite;
let workspace: string;

before(async () => {
  site = await testSite({ "/": "<h1>Shop</h1>", "/orders": "<h1>Orders</h1>" });
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
function repository(index: unknown = INDEX): string {
  const root = mkdtempSync(join(workspace, "repo-"));
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
  return { id: `p-${file}-${Object.keys(changes).join("-")}`, name: "propose_test", arguments: { application: "shop", domain: "orders", file, reason: `Checks ${file}.`, content: spec(file), ...changes } };
}

const valid = (count: number) => Array.from({ length: count }, (_, i) => propose(`test-${i + 1}.spec.ts`));
/** A reply that makes the calls, then answers enough to end the task and every reminder. */
const replies = (calls: readonly ReturnType<typeof propose>[]) => [{ body: toolCalls(MODEL, calls) }, ...Array.from({ length: 4 }, () => ({ body: answer(MODEL, "Done.") }))];

interface Setup {
  readonly root?: string;
  readonly limits?: { maxIterations: number; maxDurationMinutes: number; maxActions: number };
  readonly check?: TestCheck;
  readonly branch?: string | null;
  readonly env?: Readonly<Record<string, string>>;
}

interface Run {
  readonly outcome: DesignOutcome;
  readonly root: string;
  readonly server: ScriptedServer;
  readonly before: Record<string, string>;
}

async function design(script: readonly { status?: number; body: unknown }[], setup: Setup = {}): Promise<Run> {
  const server = await scriptedServer(script);
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
    assert.deepEqual(state.tests, [1, 2, 3].map((i) => ({ path: `apps/shop/test-${i}.spec.ts`, application: "shop", domain: "orders", reason: `Checks test-${i}.spec.ts.` })));
    assert.deepEqual(outcome.tests, state.tests);
    assert.deepEqual([state.branch, state.base, state.environment, state.producedAt, state.model.model], [BRANCH, git(root, "rev-parse", "main"), "local", "2026-11-13T10:00:00.000Z", MODEL]);
    assert.deepEqual(git(root, "log", "-1", "--format=%an <%ae>%n%B", BRANCH).split("\n").slice(0, 3), ["Test Maintainer <maintainer@example.com>", "test: add 3 generated Playwright tests", ""]);
    assert.match(messages(outcome), /The design state was written to \.oqas\/designs\/design-20261113T100000Z\.json\.\nThe tests were committed on oqas\/design-test; the active branch of the test repository is oqas\/design-test\./);
    assert.equal(git(root, "status", "--porcelain", "--untracked-files=no"), "");
    assert.equal(server.requests.length, 2);
  });

  it("gives the agent the charter, the index with what the cards say, the screens, the documents and the notes, but no contract nor base", async () => {
    const { server } = await design(replies(valid(3)));
    const tools = toolsOffered(server);
    assert.ok(tools.includes("shop_goto") && tools.includes("propose_test") && tools.includes("remember") && tools.includes("recall"));
    assert.ok(tools.some((tool) => tool.startsWith("order_specs_")) && tools.some((tool) => tool.startsWith("shop_guide_")));
    assert.deepEqual(tools.filter((tool) => /^(shop_api|ledger_api|shop_db|staging_specs|legacy)_/.test(tool)), []);
    const request = requestText(server);
    for (const fragment of [
      "PW-WAIT-01",
      "## orders: Orders",
      "- shop-api: orders — Lists and places the orders of a customer.",
      "- shop: /orders",
      "- shop (Shop, web-and-api): signs in with a form; account demo: username in process.env.SHOP_USERNAME, password in process.env.SHOP_PASSWORD.",
      "- ledger (Ledger, api): no sign-in.",
    ]) {
      assert.ok(request.includes(JSON.stringify(fragment).slice(1, -1)), fragment);
    }
    assert.ok(!request.includes("Legacy"));
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
          ? [{ kind: "charter", rule: "PW-WAIT-01", line: 4, column: 9, message: "Wait for a state, never for a fixed time." }, { kind: "compiler", code: "TS2304", line: 2, column: 1, message: "Cannot find name 'testInfo'." }]
          : [],
    };
    const root = repository();
    const { outcome } = await design(replies([propose("test-1.spec.ts"), propose("test-1.spec.ts"), propose("specs.spec.ts", { domain: "returns" }), propose("waits.spec.ts"), ...valid(3).slice(1)]), { root, check });
    const journal = messages(outcome);
    assert.match(journal, /apps\/shop\/test-1\.spec\.ts was refused: apps\/shop\/test-1\.spec\.ts is already taken/);
    assert.match(journal, /propose_test: .*domain/);
    assert.match(journal, /waits\.spec\.ts was refused: Line 4, column 9 \(rule PW-WAIT-01\): Wait for a state, never for a fixed time\./);
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
