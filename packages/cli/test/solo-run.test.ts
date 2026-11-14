import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { AgentRuntime, CommandOutcome, CommandRunner, StepCommand, TaskLimits } from "@open-qa-stack/domain";
import { answer, closedPort, scriptedServer, toolCalls, type ScriptedServer } from "@open-qa-stack/testing";
import { liveRuntime, soloCommand, SoloRun, type RunEntry, type SoloRunState } from "../src/index.ts";

const MODEL = "test-model";
const WITNESS = "postgresql://shop:w1tness-pass@127.0.0.1:5999/shop";
const workspace = mkdtempSync(join(tmpdir(), "oqas-cli-"));
let site: Server;
let siteUrl = "";
before(async () => {
  site = createServer((_request, response) => response.writeHead(200).end("ok"));
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => site.close(() => resolve()));
  rmSync(workspace, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

/** The configuration of a test repository: one API of the shop, one document, a base declared for another environment. */
function configText(modelUrl: string, changes: Record<string, unknown> = {}): string {
  return JSON.stringify({
    formatVersion: 1,
    applications: [
      {
        id: "shop",
        name: "Shop",
        type: "api",
        authentication: { method: "none" },
        environments: [
          { name: "local", apis: [{ name: "backend", baseUrl: siteUrl }] },
          { name: "staging", apis: [{ name: "backend", baseUrl: "http://127.0.0.1:1" }] },
        ],
      },
    ],
    knowledge: [
      { id: "order-specs", type: "document", path: "specs/orders.md", attachments: [{ application: "shop", environment: "local" }] },
      { id: "shop-db", type: "postgresql", connectionStringEnv: "SHOP_DB_URL", attachments: [{ application: "shop", environment: "staging" }] },
    ],
    model: { mode: "provider-key", provider: "openai", baseUrl: modelUrl, model: MODEL },
    autonomy: { level: "autonomous" },
    // The review of a plan by an agent of its own has its sessions, which the design of the agents tests.
    design: { reviewPlan: false },
    ...changes,
  });
}

/** A test repository with a remote, its configuration, a document and the base of the tests. */
function repository(config: string | undefined): string {
  const root = mkdtempSync(join(workspace, "repo-"));
  const remote = mkdtempSync(join(workspace, "remote-"));
  git(remote, "init", "-q", "--bare", "-b", "main");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Test Maintainer");
  git(root, "config", "user.email", "maintainer@example.com");
  git(root, "config", "commit.gpgsign", "false");
  mkdirSync(join(root, "specs"));
  writeFileSync(join(root, "specs", "orders.md"), "# Orders\n\nA customer places an order.\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "tests", private: true, devDependencies: { "@playwright/test": "1.64.1" } }));
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/@playwright/test": { version: "1.64.1" } } }),
  );
  writeFileSync(join(root, ".gitignore"), ".oqas/\nnode_modules/\n");
  // The types of @playwright/test the proposed tests are checked against: npm, a double here, installs nothing.
  mkdirSync(join(root, "node_modules", "@playwright", "test"), { recursive: true });
  writeFileSync(
    join(root, "node_modules", "@playwright", "test", "package.json"),
    JSON.stringify({ name: "@playwright/test", version: "1.64.1", types: "index.d.ts" }),
  );
  writeFileSync(
    join(root, "node_modules", "@playwright", "test", "index.d.ts"),
    "export interface APIResponse { ok(): boolean; text(): Promise<string>; }\nexport interface APIRequestContext { get(url: string): Promise<APIResponse>; }\nexport declare const test: ((title: string, body: (fixtures: { request: APIRequestContext }) => Promise<void>) => void) & { step<T>(title: string, body: () => Promise<T>): Promise<T> };\nexport declare function expect(value: unknown, message?: string): { toBe(expected: unknown): void; toContain(expected: string): void };\n",
  );
  if (config !== undefined) writeFileSync(join(root, "oqas.json"), config);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "chore: start the test repository");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-q", "origin", "main");
  return root;
}

/** The JSON of the reporter for test files, each one test, with the status the script gives. */
function report(
  files: readonly string[],
  status: (file: string) => "expected" | "unexpected" | "skipped" = () => "expected",
  error = "Error: the total is wrong",
): string {
  const suites = files.map((file) => {
    const reported = status(file);
    const results =
      reported === "skipped"
        ? [{ status: "skipped", errors: [] }]
        : [{ status: reported === "expected" ? "passed" : "failed", errors: reported === "expected" ? [] : [{ message: error }] }];
    return {
      title: file,
      file,
      specs: [{ title: "the test", file, line: 3, tests: [{ projectName: "shop", status: reported, expectedStatus: "passed", results }] }],
    };
  });
  return JSON.stringify({ suites });
}

interface Script {
  /** The exit code of `npm --version`. */
  readonly npm?: number;
  /** The exit code of `npm ci`. */
  readonly install?: number;
  /** The error output of a failed `npm ci`. */
  readonly installError?: string;
  /** Whether `npm ci` cannot even be called. */
  readonly installCrash?: boolean;
  /** The status of a test file when the tests run at the end, after the design. */
  readonly final?: (file: string) => "expected" | "unexpected" | "skipped";
  /** The error of a test that fails at the end. */
  readonly finalError?: string;
  /** Whether the declared addresses stop answering once the design is over. */
  readonly downAfterDesign?: boolean;
}

/** Runs the commands of the machine and of the tests: npm and Playwright are answered as scripted, the check of the addresses runs locally. */
class FakeRunner implements CommandRunner {
  public readonly commands: StepCommand[] = [];
  private readonly root: string;
  private readonly script: Script;

  public constructor(root: string, script: Script = {}) {
    this.root = root;
    this.script = script;
  }

  public async run(step: StepCommand): Promise<CommandOutcome> {
    this.commands.push(step);
    const [program, ...args] = step.command;
    const ok = (stdout = ""): CommandOutcome => ({ exitCode: 0, stdout, stderr: "" });
    if (program === "npm" && args[0] === "--version")
      return this.script.npm === undefined ? ok("11.0.0\n") : { exitCode: this.script.npm, stdout: "", stderr: "npm: not found" };
    if (program === "npm" && this.script.installCrash === true) throw new Error("spawn npm EACCES");
    if (program === "npm")
      return this.script.install === undefined
        ? ok()
        : { exitCode: this.script.install, stdout: "", stderr: this.script.installError ?? "npm error 404 Not Found\n" };
    if (program === "node" && args[0] === "-p") return ok("1.64.1\n");
    if (program === "node" && args[0] === "-e") {
      if (this.script.downAfterDesign === true && this.listedTogether)
        return ok(JSON.stringify(args.slice(3).map((url) => ({ url, answers: false, error: "ECONNREFUSED" }))));
      return new Promise((resolve) =>
        execFile(process.execPath, ["-e", args[1]!, ...args.slice(2)], { encoding: "utf8" }, (error, stdout, stderr) =>
          resolve({ exitCode: error === null ? 0 : 1, stdout, stderr }),
        ),
      );
    }
    if (args[0] === "install") return ok();
    const files = args.filter((arg) => arg.endsWith(".spec.ts"));
    if (args.includes("--list")) return ok(report(files));
    const trial = args.includes("--update-snapshots=missing");
    const out = step.env!["PLAYWRIGHT_JSON_OUTPUT_FILE"]!;
    mkdirSync(join(this.root, out, ".."), { recursive: true });
    writeFileSync(join(this.root, out), report(files, trial ? () => "expected" : (this.script.final ?? (() => "expected")), this.script.finalError));
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  /** Whether the tests designed already ran together, at the end. */
  public get finalRuns(): number {
    return this.commands.filter(isFinalRun).length;
  }

  /** Whether the tests designed were listed together, as they are once the design is over. */
  private get listedTogether(): boolean {
    return this.commands.some((command) => command.command.includes("--list") && command.command.filter((arg) => arg.endsWith(".spec.ts")).length > 1);
  }
}

/** A run of the tests at the end: no trial, more than one file. */
const isFinalRun = (command: StepCommand) =>
  command.command[1] === "test" && !command.command.includes("--list") && !command.command.includes("--update-snapshots=missing");

const submit = (name: string, args: unknown, id: string) => ({ id, name, arguments: args });
const mapped = {
  id: "orders",
  label: "Orders",
  description: "Placing an order.",
  elements: [{ file: "orders.md", role: "How an order is placed." }],
  body: "`orders.md` says how an order is placed.",
};
const index = {
  domains: [{ id: "orders", label: "Orders", description: "Placing and following an order.", from: [{ source: "order-specs", domain: "orders" }] }],
};
const spec = (title: string) =>
  `import { test, expect } from "@playwright/test";\n\ntest("${title}", async ({ request }) => {\n  await test.step("1. Get the orders", async () => {\n    const response = await request.get("/orders");\n    expect(await response.text()).toContain("A customer places an order");\n    expect("${title}").toBe("${title}");\n  });\n});\n`;
const IDS = ["test-1", "test-2", "test-3"];
const scenario = (id: string) => ({
  id,
  title: `The ${id} scenario`,
  intent: `Verifies ${id}.`,
  kind: "functional",
  case: id === "test-3" ? "negative" : "nominal",
  application: "shop",
  domain: "orders",
  sources: [{ source: "order-specs", item: "Orders" }],
  // The value a scenario enters tells it from the others, which get the same orders.
  data: [{ value: id, from: "made-up" }],
  steps: [{ action: "Get the orders", actions: [], expects: [{ result: "The orders answer", shows: ["A customer places an order"], absent: [] }] }],
});
const plan = submit("propose_plan", { scenarios: IDS.map(scenario) }, "plan");

/** The answer that ends a session of a design. */
const ended = { body: answer(MODEL, "Done.") };
/** A read of the orders, which changes nothing. */
const read = (id = "read") => ({ body: toolCalls(MODEL, [submit("order_specs_read_section", { number: 1 }, id)]) });
/** The replies of the session of a scenario: its test is run, then closed, then the agent answers. */
const written = (id: string) => [
  { body: toolCalls(MODEL, [submit("run_test", { content: spec(id) }, `r-${id}`)]) },
  { body: toolCalls(MODEL, [submit("propose_test", {}, `p-${id}`)]) },
  ended,
];
/**
 * The replies of the model for the whole chain: the check of the server, the card, the index, then the
 * session that plans — a read of the orders, the plan, an answer — and the session of each of three
 * scenarios.
 */
/** The reply of the session that plans that submits the plan. */
const planned = { body: toolCalls(MODEL, [plan]) };
const chain = () => [
  { body: { data: [] } },
  // The document is mapped by the agent that reads it: it reads it, hands its domain in with its file, then ends.
  { body: toolCalls(MODEL, [submit("order_specs_read_file", {}, "c0")]) },
  { body: toolCalls(MODEL, [submit("write_domain", mapped, "c1")]) },
  { body: answer(MODEL, "One domain.") },
  { body: toolCalls(MODEL, [submit("submit_index", index, "x1")]) },
  { body: answer(MODEL, "One domain.") },
  read(),
  planned,
  ended,
  ...IDS.flatMap(written),
  ...Array.from({ length: 4 }, () => ended),
];

interface Run {
  readonly code: number;
  readonly root: string;
  readonly err: string;
  readonly out: string;
  readonly server: ScriptedServer;
  readonly runner: FakeRunner;
}

async function solo(
  replies: readonly { body: unknown }[],
  setup: {
    config?: (modelUrl: string) => string | undefined;
    environment?: string;
    root?: (config: string | undefined) => string;
    script?: Script;
    modelUrl?: string;
    command?: boolean;
    follow?: boolean;
    now?: () => Date;
    brief?: string;
    resume?: string;
  } = {},
): Promise<Run> {
  const server = await scriptedServer(replies);
  const modelUrl = setup.modelUrl ?? server.baseUrl;
  const config = setup.config === undefined ? configText(modelUrl) : setup.config(modelUrl);
  const root = (setup.root ?? repository)(config);
  const runner = new FakeRunner(root, setup.script);
  let err = "";
  let out = "";
  try {
    const code =
      setup.command === true
        ? await soloCommand(
            setup.resume === undefined
              ? [
                  "--repository",
                  root,
                  ...(setup.environment === undefined ? [] : ["--environment", setup.environment]),
                  ...(setup.brief === undefined ? [] : ["--brief", setup.brief]),
                  "--force-cartography",
                  ...(setup.follow === true ? ["--follow"] : []),
                ]
              : ["--repository", root, "--resume", setup.resume],
            { env: { SHOP_DB_URL: WITNESS }, cwd: workspace, stdout: { write: (text) => (out += text) }, stderr: { write: (text) => (err += text) }, runner },
          )
        : await new SoloRun({
            repositoryRoot: root,
            ...(setup.environment === undefined ? {} : { environment: setup.environment }),
            ...(setup.resume === undefined ? {} : { resume: setup.resume }),
            env: { SHOP_DB_URL: WITNESS },
            write: (line) => (err += line),
            print: (line) => (out += line),
            openRuntime: (resolved) => liveRuntime(resolved, {}),
            runner,
            now: setup.now ?? (() => new Date("2026-11-13T12:00:00.000Z")),
          }).run();
    return { code, root, err, out, server, runner };
  } finally {
    await server.close();
  }
}

const stateOf = (root: string, runId = "oqas-2026-11-13T12-00-00-000Z") =>
  JSON.parse(readFileSync(join(root, ".oqas", "runs", `${runId}.json`), "utf8")) as SoloRunState;
const journalOf = (root: string) =>
  readFileSync(join(root, ".oqas", "runs", "oqas-2026-11-13T12-00-00-000Z.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as RunEntry);
/** Every file git does not track, ignored ones included, but the types the tests are checked against. */
const untracked = (root: string) =>
  git(root, "status", "--porcelain", "--untracked-files=all", "--ignored")
    .split("\n")
    .filter((line) => line !== "" && !line.includes("node_modules/"))
    .join("\n");

describe("solo command, criterion 1 — without a configuration, the command stops with 3 and touches nothing", () => {
  it("calls no model, runs nothing, and creates no file", async () => {
    const run = await solo([], { config: () => undefined });
    assert.equal(run.code, 3);
    assert.deepEqual([run.server.requests.length, run.runner.commands.length, untracked(run.root)], [0, 0, ""]);
    assert.match(run.err, /oqas\.json cannot be read/);
  });
});

describe("solo command, criterion 2 — an invalid configuration, or an environment not declared, stops with 3", () => {
  it("names the JSON path at fault, and writes nothing", async () => {
    const run = await solo([], { config: (url) => JSON.parse(JSON.stringify(configText(url))).replace('"autonomous"', '"reckless"') });
    assert.equal(run.code, 3);
    assert.match(run.err, /\/autonomy\/level/);
    assert.deepEqual([run.server.requests.length, untracked(run.root)], [0, ""]);
  });

  it("names the environment at fault, and asks for one when several are declared", async () => {
    const unknown = await solo([], { environment: "production" });
    assert.equal(unknown.code, 3);
    assert.match(unknown.err, /The environment production is not declared; the configuration declares local, staging\./);
    const unnamed = await solo([], { config: (url) => configText(url) });
    assert.equal(unnamed.code, 3);
    assert.match(unnamed.err, /Several environments are declared \(local, staging\); name one with --environment\./);
  });
});

describe("solo command, criterion 3 — a missing prerequisite stops with 4, and nothing is mapped", () => {
  it("names the folder that is no git repository, the model server that does not answer, and npm", async () => {
    const down = `http://127.0.0.1:${await closedPort()}/v1`;
    const run = await solo([], {
      environment: "local",
      modelUrl: down,
      script: { npm: 127 },
      root: (config) => {
        const root = mkdtempSync(join(workspace, "plain-"));
        writeFileSync(join(root, "oqas.json"), config!);
        return root;
      },
    });
    assert.equal(run.code, 4);
    assert.match(run.err, /is not the root of a git repository with a commit/);
    assert.match(run.err, new RegExp(`The model server at ${down.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} does not answer`));
    assert.match(run.err, /npm cannot be run/);
    assert.ok(!run.err.includes("[cartography]"));
  });
});

describe("solo command, criterion 4 — the whole chain, every test passed, exits with 0", () => {
  it("runs the six steps in order, each with its start and its end", async () => {
    const run = await solo(chain(), { environment: "local" });
    assert.equal(run.code, 0, run.err);
    const framing = journalOf(run.root)
      .filter((entry) => entry.event === "started" || entry.event === "finished")
      .map((entry) => `${entry.step}:${entry.event}`);
    assert.deepEqual(
      framing,
      ["configuration", "prerequisites", "cartography", "design", "execution", "summary"].flatMap((step) => [`${step}:started`, `${step}:finished`]),
    );
    assert.match(run.out, /^Run oqas-2026-11-13T12-00-00-000Z: exit code 0\./);
    // The default charter ends each step with a screenshot: the skeleton of each test holds it.
    assert.ok(JSON.stringify(run.server.requests.map((request) => request.body)).includes("await testInfo.attach("));
  });
});

describe("solo command, criterion 5 — a failed test exits with 1; a blocked or indeterminate one, without a failure, with 2", () => {
  it("exits with 1 when a test fails at the end, and with 2 when one is skipped", async () => {
    const failed = await solo(chain(), { environment: "local", script: { final: (file) => (file.endsWith("test-2.spec.ts") ? "unexpected" : "expected") } });
    assert.equal(failed.code, 1, failed.err);
    const skipped = await solo(chain(), { environment: "local", script: { final: (file) => (file.endsWith("test-2.spec.ts") ? "skipped" : "expected") } });
    assert.equal(skipped.code, 2, skipped.err);
  });
});

describe("solo command, criterion 6 — an application that does not answer when the tests run blocks them, and exits with 2", () => {
  it("gives blocked to every test in the state", async () => {
    const run = await solo(chain(), { environment: "local", script: { downAfterDesign: true } });
    assert.equal(run.code, 2, run.err);
    const state = stateOf(run.root);
    assert.equal(state.designed.length, 3);
    assert.deepEqual(
      state.tests.map((test) => test.verdict),
      ["blocked", "blocked", "blocked"],
    );
  });
});

describe("solo command, criteria 7 and 8 — a limit that stops a task is journaled; without a test designed, the command stops with 5 and runs nothing", () => {
  it("names the limit reached, writes no passed, and runs no test", async () => {
    const replies = [...chain().slice(0, 5), ...Array.from({ length: 3 }, () => ({ body: answer(MODEL, "I see nothing to test.") }))];
    const config = (url: string) =>
      configText(url, {
        autonomy: { level: "bounded", task: { maxIterations: 2 } },
      });
    const run = await solo(replies, { environment: "local", config });
    assert.equal(run.code, 5, run.err);
    assert.match(run.err, /reached its iterations limit/);
    assert.equal(run.runner.finalRuns, 0);
    assert.ok(stateOf(run.root).tests.every((test) => test.verdict !== "passed"));
  });
});

describe("solo command, criterion 9 — the state of a complete run", () => {
  it("holds the run, the index, the tests and their branch, the report, a verdict per test, and the duration and requests of each step", async () => {
    // A clock that moves a second at each reading, from the instant of the run: each step takes time.
    let tick = 0;
    const now = () => new Date(Date.parse("2026-11-13T12:00:00.000Z") + 1000 * tick++);
    const run = await solo(chain(), { environment: "local", now });
    const state = stateOf(run.root);
    assert.equal(state.runId, "oqas-2026-11-13T12-00-00-000Z");
    assert.equal(state.index, ".oqas/index/domain-index.json");
    assert.deepEqual([...state.designed].sort(), ["apps/shop/test-1.spec.ts", "apps/shop/test-2.spec.ts", "apps/shop/test-3.spec.ts"]);
    assert.match(state.branch!, /^oqas\/design-/);
    assert.match(state.report!, /^\.oqas\/runs\/run-.*\/report\.json$/);
    assert.ok(existsSync(join(run.root, state.run!)));
    assert.deepEqual(
      state.tests.map((test) => test.verdict),
      ["passed", "passed", "passed"],
    );
    // The state is written by the summary, which therefore is not among its steps.
    assert.deepEqual(
      state.steps.map((step) => step.step),
      ["configuration", "prerequisites", "cartography", "design", "execution"],
    );
    assert.ok(
      state.steps.find((step) => step.step === "cartography")!.modelRequests > 0 && state.steps.find((step) => step.step === "design")!.modelRequests > 0,
    );
    assert.ok(
      state.steps.every((step) => step.durationMs > 0),
      JSON.stringify(state.steps),
    );
    // Each step counts the requests of its own sessions: with the list of the models the prerequisites ask for, they are all the server received.
    assert.deepEqual(
      state.steps.map((step) => step.modelRequests),
      [0, 0, 5, 12, 0],
    );
    assert.equal(run.server.requests.length, 1 + 5 + 12);
    assert.ok(state.durationMs > state.steps.reduce((total, step) => total + step.durationMs, 0) - 1);
  });
});

describe("solo command, criteria 10 and 11 — nothing is pushed, the git configuration stays, and an uncommitted change is kept", () => {
  it("leaves the remote and the git configuration as they were after a complete run", async () => {
    let before = { remote: "", config: "" };
    const run = await solo(chain(), {
      environment: "local",
      root: (config) => {
        const root = repository(config);
        before = { remote: git(git(root, "remote", "get-url", "origin"), "for-each-ref"), config: git(root, "config", "--list", "--local") };
        return root;
      },
    });
    assert.equal(run.code, 0, run.err);
    assert.deepEqual(
      { remote: git(git(run.root, "remote", "get-url", "origin"), "for-each-ref"), config: git(run.root, "config", "--list", "--local") },
      before,
    );
  });

  it("finds an uncommitted change again, unchanged", async () => {
    const run = await solo(chain(), {
      environment: "local",
      root: (config) => {
        const root = repository(config);
        writeFileSync(join(root, "specs", "orders.md"), "# Orders\n\nAn edit under way.\n");
        return root;
      },
    });
    assert.equal(run.code, 5);
    assert.equal(readFileSync(join(run.root, "specs", "orders.md"), "utf8"), "# Orders\n\nAn edit under way.\n");
  });
});

describe("solo command, criterion 12 — the value of the connection string appears nowhere", () => {
  it("is in neither the journal, the state, nor the outputs", async () => {
    const run = await solo(chain(), { environment: "local" });
    for (const trace of [
      run.err,
      run.out,
      readFileSync(join(run.root, ".oqas", "runs", "oqas-2026-11-13T12-00-00-000Z.jsonl"), "utf8"),
      JSON.stringify(stateOf(run.root)),
    ])
      assert.ok(!trace.includes("w1tness-pass"));
  });

  it("is masked in the reason of a verdict", async () => {
    const run = await solo(chain(), {
      environment: "local",
      script: { final: (file) => (file.endsWith("test-2.spec.ts") ? "unexpected" : "expected"), finalError: `Error: cannot reach ${WITNESS}` },
    });
    assert.equal(run.code, 1, run.err);
    const failed = stateOf(run.root).tests.find((test) => test.verdict === "failed")!;
    assert.match(failed.reason, /cannot reach \[secret\]/);
    assert.ok(!run.err.includes("w1tness-pass"));
  });

  it("is masked when an output of the machine holds it", async () => {
    const run = await solo(chain(), { environment: "local", script: { install: 1, installError: `npm error cannot reach ${WITNESS}\n` } });
    assert.equal(run.code, 5, run.err);
    assert.match(run.err, /npm error cannot reach \[secret\]/);
    for (const trace of [
      run.err,
      run.out,
      readFileSync(join(run.root, ".oqas", "runs", "oqas-2026-11-13T12-00-00-000Z.jsonl"), "utf8"),
      JSON.stringify(stateOf(run.root)),
    ])
      assert.ok(!trace.includes("w1tness-pass"));
  });
});

describe("solo command, criterion 13 — the harness reaches only what the configuration declares", () => {
  it("calls the model server and the declared address, and nothing else", async () => {
    // The guard of the suite refuses any address outside this machine; here, the destinations are the scripted model and the site.
    const run = await solo(chain(), { environment: "local" });
    assert.ok(run.server.requests.length > 0);
    assert.ok(
      run.runner.commands.filter((command) => command.command[1] === "-e").every((command) => command.command.slice(4).every((url) => url === siteUrl)),
    );
  });
});

describe("solo command, criterion 14 — the command imports only shared, harness, agents, tools and domain", () => {
  it("imports no other package, and never the SDK of the agents", () => {
    const folder = new URL("../src/", import.meta.url);
    const imported = readdirSync(folder, { recursive: true })
      .filter((file) => String(file).endsWith(".ts"))
      .flatMap((file) => [...readFileSync(new URL(String(file), folder), "utf8").matchAll(/(?:from\s+|import\s*\(?\s*)"([^"]+)"/g)].map((match) => match[1]!));
    const allowed = /^(node:|\.\/|@open-qa-stack\/(shared|harness|agents|tools|domain)$)/;
    assert.ok(imported.length > 0);
    assert.deepEqual(
      imported.filter((module) => !allowed.test(module)),
      [],
    );
    assert.ok(!imported.some((module) => module.includes("copilot")));
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
    assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
      "@open-qa-stack/agents",
      "@open-qa-stack/domain",
      "@open-qa-stack/harness",
      "@open-qa-stack/shared",
      "@open-qa-stack/tools",
    ]);
  });
});

describe("solo command, criterion 15 — no test opens a model nor installs anything", () => {
  it("answers every command of npm and Playwright with the double", async () => {
    const run = await solo(chain(), { environment: "local" });
    // The design and the execution share one installation.
    assert.equal(run.runner.commands.filter((command) => command.command[0] === "npm" && command.command[1] === "ci").length, 1);
    assert.ok(run.runner.commands.every((command) => ["npm", "node", "node_modules/.bin/playwright"].includes(command.command[0]!)));
  });
});

describe("solo command, the charter and the dependencies", () => {
  it("stops with 3, before the model, on a charter that disables an unknown rule", async () => {
    const run = await solo([], { environment: "local", config: (url) => configText(url, { charter: { disable: [{ rule: "PW-NOPE-01", reason: "No." }] } }) });
    assert.equal(run.code, 3);
    assert.match(run.err, /\/charter\/disable\/0\/rule/);
    assert.equal(run.server.requests.length, 0);
  });

  it("stops with 5 before designing when the dependencies of the test repository cannot be installed", async () => {
    const run = await solo(chain(), { environment: "local", script: { install: 1 } });
    assert.equal(run.code, 5);
    assert.match(run.err, /\[design\] error: The dependencies could not be installed: npm error 404 Not Found/);
    assert.ok(!run.err.includes("propose"));
  });
});

describe("the command oqas", () => {
  it("runs the whole chain from its arguments, with the system clock and the live runtime", async () => {
    const run = await solo(chain(), { environment: "local", command: true });
    assert.equal(run.code, 0, run.err);
    assert.match(run.out, /^Run oqas-\d{4}-\d{2}-\d{2}T.*: exit code 0\./);
    // Without --follow, the error output holds the journal alone.
    assert.doesNotMatch(run.err, /^\d\d:\d\d:\d\d /m);
  });

  it("prints what the agents do while they do it, when asked to follow", async () => {
    const run = await solo(chain(), { environment: "local", command: true, follow: true });
    assert.equal(run.code, 0, run.err);
    // Each call of a tool with its result, each message of the harness, and what each phase asked of the model.
    assert.match(run.err, /^\d\d:\d\d:\d\d plan -> propose_plan\(/m);
    assert.match(run.err, /^\d\d:\d\d:\d\d plan <- The plan is not closed yet\. It holds 3 of 8 scenarios at most: test-1, test-2, test-3\./m);
    assert.match(run.err, /^\d\d:\d\d:\d\d write harness: Write the test of this scenario/m);
    assert.match(run.err, /^\d\d:\d\d:\d\d plan \d+ model requests/m);
    // The journal is still printed, and an entry of the journal is printed once.
    assert.equal(run.err.split("\n").filter((line) => line.includes("The plan was accepted:")).length, 1);
  });
});

describe("what the brief asks and the plan leaves out", () => {
  it("is printed in the summary and kept in the state of the run, and neither for a plan that covers the brief", async () => {
    const uncovered = [{ asked: "Cancel an order.", reason: "No operation of the shop cancels one." }];
    const partial = submit("propose_plan", { scenarios: IDS.map(scenario), uncovered }, "plan");
    const replies = chain().map((reply) => (reply.body === planned.body ? { body: toolCalls(MODEL, [partial]) } : reply));
    const run = await solo(replies, { environment: "local", command: true });
    assert.equal(run.code, 0, run.err);
    assert.match(run.out, /\nNot covered: Cancel an order\. No operation of the shop cancels one\.\nState: /);
    const [state] = readdirSync(join(run.root, ".oqas", "runs")).filter((file) => file.endsWith(".json"));
    assert.deepEqual((JSON.parse(readFileSync(join(run.root, ".oqas", "runs", state!), "utf8")) as { uncovered?: unknown }).uncovered, uncovered);
    const whole = await solo(chain(), { environment: "local", command: true });
    assert.doesNotMatch(whole.out, /Not covered/);
    const [covered] = readdirSync(join(whole.root, ".oqas", "runs")).filter((file) => file.endsWith(".json"));
    assert.equal("uncovered" in (JSON.parse(readFileSync(join(whole.root, ".oqas", "runs", covered!), "utf8")) as object), false);
  });
});

describe("a brief no test can do", () => {
  it("runs nothing, says what is not covered, and exits with 2: nothing was verified", async () => {
    const uncovered = [{ asked: "Cancel an order.", reason: "No operation of the shop cancels one." }];
    const none = submit("propose_plan", { scenarios: [], uncovered }, "plan");
    const replies = chain().map((reply) => (reply.body === planned.body ? { body: toolCalls(MODEL, [none]) } : reply));
    const run = await solo(replies, { environment: "local", command: true });
    assert.equal(run.code, 2, run.err);
    assert.match(run.err, /\[design\] No test is run: the design gave none\./);
    assert.doesNotMatch(run.err, /\[execution\]/);
    assert.match(run.out, /\nNot covered: Cancel an order\. No operation of the shop cancels one\.\nState: /);
    assert.equal(run.runner.finalRuns, 0);
  });
});

describe("the brief of a run", () => {
  it("goes from the option to the designer, and to the state of the design", async () => {
    const run = await solo(chain(), { environment: "local", command: true, brief: "tester la recherche d'un client" });
    assert.equal(run.code, 0, run.err);
    assert.ok(run.server.requests.some((request) => (JSON.stringify(request.body) ?? "").includes("<brief>\\ntester la recherche d'un client\\n</brief>")));
    const designs = join(run.root, ".oqas", "designs");
    const [design] = readdirSync(designs);
    assert.equal((JSON.parse(readFileSync(join(designs, design!), "utf8")) as { brief: string }).brief, "tester la recherche d'un client");
  });
});

describe("the edges of a run", () => {
  it("takes the folder it runs in as the test repository, and the only environment declared", async () => {
    const server = await scriptedServer([]);
    const single = configText(server.baseUrl, {
      applications: [
        {
          id: "shop",
          name: "Shop",
          type: "api",
          authentication: { method: "none" },
          environments: [{ name: "local", apis: [{ name: "backend", baseUrl: siteUrl }] }],
        },
      ],
      knowledge: [{ id: "order-specs", type: "document", path: "specs/orders.md", attachments: [{ application: "shop" }] }],
    });
    const root = repository(single);
    let err = "";
    try {
      const code = await soloCommand([], {
        env: { SHOP_DB_URL: WITNESS },
        cwd: root,
        stdout: { write: () => true },
        stderr: { write: (text) => (err += text) },
        runner: new FakeRunner(root, { npm: 127 }),
      });
      assert.equal(code, 4);
      assert.match(err, /the run targets the environment local\./);
    } finally {
      await server.close();
    }
  });

  it("names the whole document for an error of syntax, and checks npm with the machine's runner by default", async () => {
    const broken = await solo([], { config: () => "{" });
    assert.equal(broken.code, 3);
    assert.match(broken.err, /\[configuration\] error: \/: /);
    const down = `http://127.0.0.1:${await closedPort()}/v1`;
    const root = repository(configText(down));
    let err = "";
    const code = await new SoloRun({
      repositoryRoot: root,
      environment: "local",
      env: { SHOP_DB_URL: WITNESS },
      write: (line) => (err += line),
      print: () => undefined,
      openRuntime: (config) => liveRuntime(config, {}),
    }).run();
    assert.equal(code, 4);
    assert.ok(!err.includes("npm cannot be run"), err);
  });

  it("stops with 5 on an unexpected error in a step, closes the step, and keeps what the steps before produced", async () => {
    const run = await solo(chain(), { environment: "local", script: { installCrash: true } });
    assert.equal(run.code, 5, run.err);
    assert.match(run.err, /\[design\] error: The design stopped on an unexpected error: spawn npm EACCES/);
    assert.match(run.err, /\[design\] finished: The design did not succeed\./);
    const state = stateOf(run.root);
    assert.deepEqual([state.exitCode, state.index, state.steps.at(-1)?.step], [5, ".oqas/index/domain-index.json", "design"]);
  });

  it("counts the requests of a step that throws once its sessions ran", async () => {
    // A hook that refuses every commit: the designer throws when it commits the tests it wrote.
    const run = await solo(chain(), {
      environment: "local",
      root: (config) => {
        const root = repository(config);
        writeFileSync(join(root, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
        return root;
      },
    });
    assert.equal(run.code, 5, run.err);
    assert.match(run.err, /\[design\] error: The design stopped on an unexpected error/);
    assert.equal(stateOf(run.root).steps.find((step) => step.step === "design")!.modelRequests, 12);
  });

  it("stops with 5 when the runtime of the agents cannot be opened, and still writes the state", async () => {
    const server = await scriptedServer([]);
    const root = repository(configText(server.baseUrl));
    let err = "";
    try {
      const code = await new SoloRun({
        repositoryRoot: root,
        environment: "local",
        env: { SHOP_DB_URL: WITNESS },
        write: (line) => (err += line),
        print: () => undefined,
        openRuntime: () => Promise.reject("no runtime"),
        runner: new FakeRunner(root),
        now: () => new Date("2026-11-13T12:00:00.000Z"),
      }).run();
      assert.equal(code, 5);
      assert.match(err, /\[cartography\] error: The cartography stopped on an unexpected error: no runtime/);
      assert.equal(stateOf(root).exitCode, 5);
    } finally {
      await server.close();
    }
  });

  it("journals a runtime that cannot be closed, and writes the state all the same", async () => {
    const server = await scriptedServer(chain());
    const root = repository(configText(server.baseUrl));
    let err = "";
    try {
      const code = await new SoloRun({
        repositoryRoot: root,
        environment: "local",
        env: { SHOP_DB_URL: WITNESS },
        write: (line) => (err += line),
        print: () => undefined,
        openRuntime: async (config) => {
          const open = await liveRuntime(config, {});
          return { runtime: open.runtime, close: () => open.close().then(() => Promise.reject(new Error("the gateway hangs"))) };
        },
        runner: new FakeRunner(root),
        now: () => new Date("2026-11-13T12:00:00.000Z"),
      }).run();
      assert.equal(code, 0, err);
      assert.match(err, /\[summary\] error: The runtime of the agents could not be closed: the gateway hangs/);
      assert.equal(stateOf(root).exitCode, 0);
    } finally {
      await server.close();
    }
  });

  it("journals a state that cannot be written, and throws", async () => {
    const server = await scriptedServer([]);
    const root = repository(configText(server.baseUrl));
    // A folder where the state goes: the state cannot be written there.
    mkdirSync(join(root, ".oqas", "runs", "oqas-2026-11-13T12-00-00-000Z.json"), { recursive: true });
    let err = "";
    try {
      const run = new SoloRun({
        repositoryRoot: root,
        environment: "local",
        env: { SHOP_DB_URL: WITNESS },
        write: (line) => (err += line),
        print: () => undefined,
        openRuntime: () => Promise.reject(new Error("no runtime")),
        runner: new FakeRunner(root),
        now: () => new Date("2026-11-13T12:00:00.000Z"),
      });
      await assert.rejects(run.run(), /EISDIR/);
      assert.match(err, /\[summary\] error: The summary stopped on an unexpected error: EISDIR/);
      assert.match(journalOf(root).at(-1)!.message, /The summary did not succeed\./);
    } finally {
      await server.close();
    }
  });

  it("exits with 5 when its error output closes, and says why on it as long as it can", async () => {
    const server = await scriptedServer([]);
    const root = repository(configText(server.baseUrl));
    let err = "";
    try {
      // The lines of the summary are refused: the summary cannot even tell why it stopped.
      const code = await soloCommand(["--environment", "local"], {
        env: { SHOP_DB_URL: WITNESS },
        cwd: root,
        stdout: { write: () => true },
        stderr: {
          write: (text) => {
            if (text.startsWith("[summary]")) throw new Error("the output is closed");
            err += text;
            return true;
          },
        },
        runner: new FakeRunner(root),
        connect: () => Promise.reject(new Error("no runtime")),
      });
      assert.equal(code, 5);
      assert.match(err, /oqas stopped on an unexpected error: the output is closed/);
    } finally {
      await server.close();
    }
  });

  it("stops with 5 when no index is written, and designs nothing", async () => {
    const replies = [{ body: { data: [] } }, ...Array.from({ length: 6 }, () => ({ body: answer(MODEL, "Nothing to say.") }))];
    const run = await solo(replies, { environment: "local" });
    assert.equal(run.code, 5);
    assert.match(run.err, /No index was written/);
    assert.ok(!run.err.includes("[design]"));
    assert.equal(stateOf(run.root).index, undefined);
    // The requests of a cartography that wrote no index are counted all the same.
    assert.ok(stateOf(run.root).steps.find((step) => step.step === "cartography")!.modelRequests > 0);
  });
});

describe("the guardrail of a run", () => {
  /** A run whose clock reads its start, then `after` every time once more; with the limits of each session its agents opened. */
  async function guarded(autonomy: unknown, after: string) {
    const server = await scriptedServer(chain());
    const root = repository(configText(server.baseUrl, { autonomy }));
    const limits: (TaskLimits | undefined)[] = [];
    let err = "";
    let read = false;
    try {
      const code = await new SoloRun({
        repositoryRoot: root,
        environment: "local",
        env: { SHOP_DB_URL: WITNESS },
        write: (line) => (err += line),
        print: () => undefined,
        openRuntime: async (config) => {
          const open = await liveRuntime(config, {});
          const runtime: AgentRuntime = {
            openSession: (options) => {
              limits.push(options.limits);
              return open.runtime.openSession(options);
            },
            close: () => open.runtime.close(),
          };
          return { runtime, close: () => open.close() };
        },
        runner: new FakeRunner(root),
        now: () => {
          const at = new Date(read ? after : "2026-11-13T12:00:00.000Z");
          read = true;
          return at;
        },
      }).run();
      return { code, err, limits, root };
    } finally {
      await server.close();
    }
  }

  it("gives every session the time left until the guardrail, counted from the start of the run", async () => {
    const run = await guarded({ level: "autonomous", guardrailMinutes: 1 }, "2026-11-13T12:00:20.000Z");
    assert.equal(run.code, 0, run.err);
    assert.ok(run.limits.length > 0);
    assert.ok(run.limits.every((limits) => limits?.maxDurationMs === 40_000));
  });

  it("stops a task opened once the guardrail is reached, by its duration limit", async () => {
    const run = await guarded({ level: "autonomous", guardrailMinutes: 1 }, "2026-11-13T12:01:00.000Z");
    assert.equal(run.code, 5, run.err);
    assert.match(run.err, /The session that maps order-specs reached its duration limit\./);
    assert.equal(run.limits[0]?.maxDurationMs, 0);
    assert.deepEqual(stateOf(run.root).stoppedBy, { step: "cartography", limit: "duration" });
  });

  it("bounds no session by the clock when the level sets no guardrail", async () => {
    const run = await guarded({ level: "bounded", task: { maxIterations: 100 } }, "2026-11-13T14:00:00.000Z");
    assert.equal(run.code, 0, run.err);
    assert.ok(run.limits.every((limits) => limits?.maxDurationMs === null));
  });
});

/** The identifier of the first run of each test, and the clock of the run that resumes it. */
const FIRST_RUN = "oqas-2026-11-13T12-00-00-000Z";
const later = (hour: number) => () => new Date(`2026-11-13T${hour}:00:00.000Z`);
/** A configuration whose tasks stop at their nth model call. */
const boundedTo = (maxIterations: number) => (url: string) => configText(url, { autonomy: { level: "bounded", task: { maxIterations } } });
/** The names of the tools the model was offered in a request. */
const offered = (body: unknown) => (body as { tools: { function: { name: string } }[] }).tools.map((tool) => tool.function.name);
/** The files of the tests a run tried while it designed them. */
const tried = (runner: FakeRunner) =>
  runner.commands
    .filter((command) => command.command.includes("--update-snapshots=missing"))
    .flatMap((command) => command.command.filter((arg) => arg.endsWith(".spec.ts")));

describe("autonomy, criterion 4 — a design stopped by maxIterations after a plan and a kept test is resumed with --resume", () => {
  it("gives the resumed sessions the sheets of the scenarios left, plans nothing, and ends the branch with the tests of both", async () => {
    const replies = chain();
    // The first run: the check of the server, the cartography, the plan, test-1, then the session of test-2 cut at its fifth call, its test run but not closed.
    const cut = [written("test-2")[0]!, read("l1"), read("l2"), read("l3"), read("l4")];
    const server = await scriptedServer([...replies.slice(0, 12), ...cut, { body: { data: [] } }, ...written("test-2"), ...written("test-3")]);
    try {
      const first = await solo([], { environment: "local", modelUrl: server.baseUrl, config: boundedTo(5) });
      assert.equal(first.code, 5, first.err);
      assert.equal(server.requests.length, 1 + 5 + 3 + 3 + 5);
      assert.match(first.err, /The task reached its iterations limit; no test was written for the scenario under way\./);
      assert.match(first.out, new RegExp(`The design was stopped by its iterations limit; resume the run with: oqas --resume ${FIRST_RUN}\n`));
      const stopped = stateOf(first.root);
      assert.deepEqual(stopped.stoppedBy, { step: "design", limit: "iterations" });
      assert.deepEqual(stopped.designed, ["apps/shop/test-1.spec.ts"]);
      const branch = stopped.branch!;
      const base = git(first.root, "rev-parse", `${branch}~1`);

      const resumed = await solo([], { root: () => first.root, modelUrl: server.baseUrl, config: boundedTo(5), resume: FIRST_RUN, now: later(13) });
      assert.equal(resumed.code, 0, resumed.err);
      // The first session of the run resumed is that of the first scenario not closed: it is given its sheet, not the test kept.
      const session = server.requests[18]!.body;
      assert.ok(JSON.stringify(session).includes("Scenario 2 of 3: test-2"), "the session is given the sheet of the scenario left");
      assert.ok(!JSON.stringify(session).includes("test-1"), "the session is not given the kept test");
      assert.ok(!offered(session).includes("propose_plan"));
      assert.ok(!server.requests.slice(18).some((request) => JSON.stringify(request.body).includes('"name":"propose_plan"')));
      // The resumed design tries the tests of the scenarios left, never the kept one.
      assert.deepEqual(tried(resumed.runner), ["apps/shop/test-2.spec.ts", "apps/shop/test-3.spec.ts"]);
      const state = stateOf(first.root, "oqas-2026-11-13T13-00-00-000Z");
      assert.deepEqual([state.resumes, state.branch, state.stoppedBy], [FIRST_RUN, branch, undefined]);
      assert.deepEqual(state.designed, ["apps/shop/test-1.spec.ts", "apps/shop/test-2.spec.ts", "apps/shop/test-3.spec.ts"]);
      assert.deepEqual(
        state.steps.map((step) => step.step),
        ["configuration", "prerequisites", "design", "execution"],
      );
      assert.deepEqual(git(first.root, "ls-tree", "-r", "--name-only", branch, "apps").split("\n"), [
        "apps/shop/test-1.spec.ts",
        "apps/shop/test-2.spec.ts",
        "apps/shop/test-3.spec.ts",
      ]);
      assert.equal(git(first.root, "rev-parse", `${branch}~2`), base, "one commit for each run, on the same branch");
    } finally {
      await server.close();
    }
  });

  it("keeps the cards a cartography made, then the plan of a design stopped before its first test", async () => {
    const bad = { body: toolCalls(MODEL, [submit("submit_index", { domains: [] }, "x0")]) };
    const server = await scriptedServer([
      // The session that maps the document is cut at its second call, once its domain is handed in: its last answer is never asked.
      ...chain().slice(0, 3),
      bad,
      bad,
      { body: { data: [] } },
      // The index, the plan, at the second and last call of its session, then the session of test-1, cut before it ran anything.
      ...chain().slice(4, 8),
      read("l1"),
      read("l2"),
      { body: { data: [] } },
      // The session of test-1, closed at its last call, then that of test-2, cut.
      ...written("test-1").slice(0, 2),
      read("l3"),
      read("l4"),
    ]);
    try {
      const first = await solo([], { environment: "local", modelUrl: server.baseUrl, config: boundedTo(2) });
      assert.equal(first.code, 5, first.err);
      assert.deepEqual(stateOf(first.root).stoppedBy, { step: "cartography", limit: "iterations" });
      const again = await solo([], { root: () => first.root, modelUrl: server.baseUrl, config: boundedTo(2), resume: FIRST_RUN, now: later(13) });
      assert.equal(again.code, 5, again.err);
      assert.match(again.err, /The card of order-specs is up to date; it was kept\./);
      const second = stateOf(first.root, "oqas-2026-11-13T13-00-00-000Z");
      assert.deepEqual([second.stoppedBy, second.branch, second.designed], [{ step: "design", limit: "iterations" }, undefined, []]);
      assert.ok(second.designState !== undefined);
      const third = await solo([], {
        root: () => first.root,
        modelUrl: server.baseUrl,
        config: boundedTo(2),
        resume: "oqas-2026-11-13T13-00-00-000Z",
        now: later(14),
      });
      assert.equal(third.code, 5, third.err);
      const last = stateOf(first.root, "oqas-2026-11-13T14-00-00-000Z");
      assert.deepEqual([last.designed, last.designState], [["apps/shop/test-1.spec.ts"], second.designState]);
      assert.equal(git(first.root, "ls-tree", "-r", "--name-only", last.branch!, "apps"), "apps/shop/test-1.spec.ts");
    } finally {
      await server.close();
    }
  });

  it("offers to resume a design a limit cut short after some of its tests, which run once every scenario has its own", async () => {
    const four = [...IDS, "test-4"];
    // The first run: the check of the server, the cartography, a plan of four scenarios, three tests, then the session of the fourth cut at its fourth call.
    const server = await scriptedServer([
      ...chain().slice(0, 7),
      { body: toolCalls(MODEL, [submit("propose_plan", { scenarios: four.map(scenario) }, "plan")]) },
      ended,
      ...IDS.flatMap(written),
      read("l1"),
      read("l2"),
      read("l3"),
      read("l4"),
      { body: { data: [] } },
      ...written("test-4"),
    ]);
    try {
      const first = await solo([], { environment: "local", modelUrl: server.baseUrl, config: boundedTo(4) });
      assert.equal(first.code, 5, first.err);
      const stopped = stateOf(first.root);
      // Three tests are kept on the branch, and none runs yet: the plan has a fourth scenario.
      assert.deepEqual([stopped.stoppedBy, stopped.designed.length, stopped.tests.length], [{ step: "design", limit: "iterations" }, 3, 0]);
      assert.match(first.out, new RegExp(`The design was stopped by its iterations limit; resume the run with: oqas --resume ${FIRST_RUN}\n`));
      const resumed = await solo([], { root: () => first.root, modelUrl: server.baseUrl, config: boundedTo(4), resume: FIRST_RUN, now: later(13) });
      assert.equal(resumed.code, 0, resumed.err);
      assert.deepEqual(tried(resumed.runner), ["apps/shop/test-4.spec.ts"]);
      const state = stateOf(first.root, "oqas-2026-11-13T13-00-00-000Z");
      assert.deepEqual([state.stoppedBy, state.designed.length, state.tests.length], [undefined, 4, 4]);
    } finally {
      await server.close();
    }
  });
});

describe("autonomy, criterion 5 — --resume of a run no limit stopped stops with 3, and says so", () => {
  it("names the run that was not stopped by a limit, and the one whose state cannot be read", async () => {
    const done = await solo(chain(), { environment: "local" });
    assert.equal(done.code, 0, done.err);
    const again = await solo([], { root: () => done.root, command: true, resume: FIRST_RUN });
    assert.equal(again.code, 3);
    assert.match(again.err, new RegExp(`The run ${FIRST_RUN} was not stopped by a limit; only a run a limit stopped can be resumed\\.`));
    assert.equal(again.server.requests.length, 0);
    const unknown = await solo([], { root: () => done.root, command: true, resume: "oqas-2020-01-01T00-00-00-000Z" });
    assert.equal(unknown.code, 3);
    assert.match(unknown.err, /The run oqas-2020-01-01T00-00-00-000Z cannot be resumed: its state .* cannot be read\./);
  });

  it("refuses a state whose content is not that of a run, and a run stopped in its design without an index", async () => {
    const done = await solo(chain(), { environment: "local" });
    const runs = join(done.root, ".oqas", "runs");
    const { index: _index, ...complete } = stateOf(done.root);
    for (const [runId, content] of [
      ["oqas-2026-11-13T15-00-00-000Z", "null"],
      ["oqas-2026-11-13T16-00-00-000Z", "{"],
      [
        "oqas-2026-11-13T17-00-00-000Z",
        JSON.stringify({ ...complete, runId: "oqas-2026-11-13T17-00-00-000Z", stoppedBy: { step: "design", limit: "iterations" } }),
      ],
      ["oqas-2026-11-13T18-00-00-000Z", JSON.stringify({ ...complete, stoppedBy: { step: "design", limit: "iterations" } })],
    ] as const) {
      writeFileSync(join(runs, `${runId}.json`), content);
      const again = await solo([], { root: () => done.root, command: true, resume: runId });
      assert.equal(again.code, 3, runId);
      assert.match(again.err, new RegExp(`The run ${runId} cannot be resumed: its state .* cannot be read\\.`));
      assert.equal(again.server.requests.length, 0);
    }
  });

  it("resumes a run once, and names the run that resumed it", async () => {
    const done = await solo(chain(), { environment: "local" });
    const runs = join(done.root, ".oqas", "runs");
    const stopped = { ...stateOf(done.root), stoppedBy: { step: "design", limit: "iterations" } };
    const resumer = "oqas-2026-11-13T13-00-00-000Z";
    writeFileSync(join(runs, `${FIRST_RUN}.json`), JSON.stringify(stopped));
    writeFileSync(join(runs, `${resumer}.json`), JSON.stringify({ ...stopped, runId: resumer, resumes: FIRST_RUN, stoppedBy: undefined }));
    const twice = await solo([], { root: () => done.root, command: true, resume: FIRST_RUN });
    assert.equal(twice.code, 3);
    assert.match(twice.err, new RegExp(`The run ${FIRST_RUN} was resumed already, by the run ${resumer}; resume that one instead, if a limit stopped it\\.`));
    assert.equal(twice.server.requests.length, 0);
  });
});
