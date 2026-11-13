import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { CommandOutcome, CommandRunner, StepCommand } from "@open-qa-stack/domain";
import { validateConfig, type ResolvedConfig } from "@open-qa-stack/shared";
import { closedPort } from "@open-qa-stack/testing";
import { baseUrlVariable, listedTests, LocalRunner, PinnedRun, reportedTests, testRepositoryBase, TrialRunner, type RunOutcome } from "../src/index.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-pinned-run-"));
const FIXTURES = new URL("./fixtures/reporter/", import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, FIXTURES), "utf8");

let site: Server;
let siteUrl = "";
let down = "";
let downToo = "";
let hung = "";
let silentServer: Server;
before(async () => {
  site = createServer((request, response) => {
    response.writeHead(request.url === "/broken" ? 500 : 200);
    response.end("ok");
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  down = `http://127.0.0.1:${await closedPort()}`;
  downToo = `http://127.0.0.1:${await closedPort()}`;
  silentServer = createServer(() => undefined);
  await new Promise<void>((resolve) => silentServer.listen(0, "127.0.0.1", resolve));
  hung = `http://127.0.0.1:${(silentServer.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => site.close(() => resolve()));
  silentServer.closeAllConnections();
  await new Promise<void>((resolve) => silentServer.close(() => resolve()));
  rmSync(workspace, { recursive: true, force: true });
});

function configFor(uiUrl: string, apiUrl = `${uiUrl}/api`): ResolvedConfig {
  const text = JSON.stringify({
    formatVersion: 1,
    applications: [{ id: "shop", name: "Shop", type: "web-and-api", authentication: { method: "none" }, environments: [{ name: "local", uiUrl, apis: [{ name: "backend", baseUrl: apiUrl }] }] }],
    knowledge: [],
    model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: "m" },
    autonomy: { level: "autonomous" },
  });
  const result = validateConfig(text, {});
  assert.ok(result.ok, JSON.stringify(result));
  return result.config;
}

const lockOf = (version: string) => JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/@playwright/test": { version } } });

/** A test repository, a git repository with one commit and a remote reference, holding a lockfile. */
function repository(version: string | null = "1.64.1"): string {
  const root = mkdtempSync(join(workspace, "repo-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  if (version !== null) writeFileSync(join(root, "package-lock.json"), lockOf(version));
  writeFileSync(join(root, ".gitignore"), ".oqas/\n");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  return root;
}

/** What the fake runner writes as the reporter's JSON: a fixture, an empty file, a broken one, or nothing. */
type Report = { readonly fixture: string } | { readonly text: string } | "none";

interface Script {
  /** Version the container resolves for `@playwright/test`. */
  readonly resolved?: string;
  readonly installExit?: number;
  readonly browsersExit?: number;
  readonly listExit?: number;
  readonly list?: string;
  readonly report?: Report;
  readonly runExit?: number;
  /** An address the checks made after the run find down. */
  readonly downAfterRun?: string;
}

/** A runner of the steps that installs and runs nothing: it answers each step as scripted, and runs the check of the addresses with the local Node.js. */
class FakeRunner implements CommandRunner {
  public readonly commands: StepCommand[] = [];
  private readonly script: Script;
  private readonly root: string;

  public constructor(root: string, script: Script = {}) {
    this.root = root;
    this.script = script;
  }

  public async run(command: StepCommand): Promise<CommandOutcome> {
    this.commands.push(command);
    const [program, ...args] = command.command;
    const ok = (stdout = ""): CommandOutcome => ({ exitCode: 0, stdout, stderr: "" });
    if (program === "npm") return this.script.installExit === undefined ? ok() : { exitCode: this.script.installExit, stdout: "", stderr: "npm error network unreachable\n" };
    if (program === "node" && args[0] === "-p") return ok(`${this.script.resolved ?? "1.64.1"}\n`);
    if (program === "node" && args[0] === "-e" && this.ranTests && this.script.downAfterRun !== undefined) {
      return ok(JSON.stringify(args.slice(2).map((url) => ({ url, answers: url !== this.script.downAfterRun }))));
    }
    if (program === "node" && args[0] === "-e") {
      // Asynchronous, so that the site of the test, in this process, can answer meanwhile.
      return new Promise((resolve) => execFile(process.execPath, ["-e", args[1]!, ...args.slice(2)], { encoding: "utf8" }, (error, stdout, stderr) => resolve({ exitCode: error === null ? 0 : 1, stdout, stderr })));
    }
    if (args[0] === "install") return this.script.browsersExit === undefined ? ok() : { exitCode: this.script.browsersExit, stdout: "", stderr: "Failed to download chromium\n" };
    if (args.includes("--list")) return this.script.listExit === undefined ? ok(this.script.list ?? fixture("list.json")) : { exitCode: this.script.listExit, stdout: "", stderr: "Error: no tests found\n" };
    const report = this.script.report ?? { fixture: "run.json" };
    if (report !== "none") {
      const target = command.env!["PLAYWRIGHT_JSON_OUTPUT_FILE"]!;
      mkdirSync(join(this.root, target, ".."), { recursive: true });
      writeFileSync(join(this.root, target), "fixture" in report ? fixture(report.fixture) : report.text);
    }
    return { exitCode: this.script.runExit ?? 1, stdout: "Running 5 tests using 1 worker\n", stderr: "" };
  }

  /** Whether the tests themselves were run. */
  public get ranTests(): boolean {
    return this.commands.some((command) => command.command.includes("test") && !command.command.includes("--list"));
  }
}

const FILES = ["apps/shop/a.spec.ts", "apps/shop/b.spec.ts"];
const NOW = () => new Date("2026-11-13T12:00:00.000Z");

async function runIn(root: string, runner: FakeRunner, uiUrl = siteUrl, apiUrl?: string): Promise<RunOutcome> {
  return new PinnedRun({ config: configFor(uiUrl, apiUrl), environment: "local", repositoryRoot: root, tests: FILES, runner, now: NOW, reachTimeoutMs: 2000 }).run();
}
const verdicts = (outcome: RunOutcome) => outcome.result.tests.map((test) => test.verdict);
/** How many tests got each verdict. */
const tally = (outcome: RunOutcome) => outcome.result.tests.reduce<Record<string, number>>((counts, test) => ({ ...counts, [test.verdict]: (counts[test.verdict] ?? 0) + 1 }), {});

describe("criterion 1 — the tests run at the version the lockfile installs, on the machine", () => {
  it("installs the dependencies, then the browsers of the locked version, and gives each project its address", async () => {
    for (const version of ["1.64.1", "1.65.0"]) {
      const root = repository(version);
      const runner = new FakeRunner(root, { resolved: version });
      const outcome = await runIn(root, runner);
      assert.deepEqual(runner.commands.slice(0, 3).map((command) => command.command), [
        ["npm", "ci", "--no-audit", "--no-fund", "--no-update-notifier"],
        ["node_modules/.bin/playwright", "install", "chromium"],
        ["node", "-p", "require('@playwright/test/package.json').version"],
      ]);
      assert.equal(outcome.result.playwright, version);
      assert.deepEqual([runner.commands[0]!.env![baseUrlVariable("shop")], runner.commands[0]!.env!["OQAS_ENVIRONMENT"]], [siteUrl, "local"]);
    }
  });

  it("lists and runs the given files only", async () => {
    const root = repository();
    const runner = new FakeRunner(root);
    await runIn(root, runner);
    const playwright = runner.commands.filter((command) => command.command[0] === "node_modules/.bin/playwright" && command.command[1] === "test");
    assert.equal(playwright.length, 2);
    assert.ok(playwright.every((command) => JSON.stringify(command.command.slice(-FILES.length)) === JSON.stringify(FILES)));
  });

  it("gives an application without an interface its first API as base address", async () => {
    const text = JSON.stringify({
      formatVersion: 1,
      applications: [{ id: "billing", name: "Billing", type: "api", authentication: { method: "none" }, environments: [{ name: "local", apis: [{ name: "backend", baseUrl: `${siteUrl}/billing` }] }] }],
      knowledge: [],
      model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: "m" },
      autonomy: { level: "autonomous" },
    });
    const config = validateConfig(text, {});
    assert.ok(config.ok);
    const root = repository();
    const runner = new FakeRunner(root);
    await new PinnedRun({ config: config.config, environment: "local", repositoryRoot: root, tests: FILES, runner, now: NOW }).run();
    assert.equal(runner.commands[0]!.env![baseUrlVariable("billing")], `${siteUrl}/billing`);
  });
});

describe("criterion 2 — without a readable lockfile, or with another version in the container, no test runs", () => {
  it("gives each file not_run naming the lockfile, and asks the engine for nothing", async () => {
    const root = repository(null);
    const engine = new FakeRunner(root);
    const outcome = await runIn(root, engine);
    assert.equal(engine.commands.length, 0);
    assert.deepEqual(outcome.result.tests.map((test) => [test.id, test.verdict]), FILES.map((file) => [file, "not_run"]));
    assert.match(outcome.result.tests[0]!.reason, /package-lock\.json/);
  });

  it("gives each file not_run naming both versions when the container resolves another", async () => {
    const root = repository("1.64.1");
    const engine = new FakeRunner(root, { resolved: "1.63.0" });
    const outcome = await runIn(root, engine);
    assert.equal(engine.ranTests, false);
    assert.deepEqual(verdicts(outcome), ["not_run", "not_run"]);
    assert.match(outcome.result.tests[0]!.reason, /1\.63\.0.*1\.64\.1/);
    const missing = repository();
    const absent = await runIn(missing, new FakeRunner(missing, { resolved: "" }));
    assert.equal(absent.result.tests[0]!.reason, "@playwright/test cannot be found is installed, the lockfile asks for 1.64.1.");
  });

  it("gives not_run when the dependencies or the browsers cannot be installed, or the runner cannot list", async () => {
    const install = repository();
    const failedInstall = await runIn(install, new FakeRunner(install, { installExit: 1 }));
    assert.equal(failedInstall.result.tests[0]!.reason, "The dependencies could not be installed: npm error network unreachable");
    const browsers = repository();
    const failedBrowsers = await runIn(browsers, new FakeRunner(browsers, { browsersExit: 1 }));
    assert.equal(failedBrowsers.result.tests[0]!.reason, "The browsers of Playwright 1.64.1 could not be installed: Failed to download chromium");
    const list = repository();
    const failedList = await runIn(list, new FakeRunner(list, { listExit: 1 }));
    assert.deepEqual([verdicts(failedList), failedList.result.tests[0]!.reason], [["not_run", "not_run"], "The runner could not list the tests: Error: no tests found"]);
    const garbled = repository();
    assert.deepEqual(verdicts(await runIn(garbled, new FakeRunner(garbled, { list: "not json" }))), ["not_run", "not_run"]);
  });
});

describe("criterion 3 — an address that does not answer the check blocks every listed test", () => {
  it("runs no test, and names the address", async () => {
    const root = repository();
    const engine = new FakeRunner(root);
    const outcome = await runIn(root, engine, siteUrl, down);
    assert.equal(engine.ranTests, false);
    const listed = listedTests(fixture("list.json"))!;
    assert.deepEqual(outcome.result.tests.map((test) => test.id), listed.map((test) => test.id));
    assert.ok(outcome.result.tests.every((test) => test.verdict === "blocked" && test.reason === `${down} does not answer: no test was run.`));
    assert.deepEqual(outcome.result.addresses.map((address) => [address.url, address.answers]), [[siteUrl, true], [down, false]]);
  });

  it("counts an address that does not answer in time as not answering", async () => {
    const root = repository();
    const runner = new FakeRunner(root);
    const outcome = await new PinnedRun({ config: configFor(siteUrl, hung), environment: "local", repositoryRoot: root, tests: FILES, runner, now: NOW, reachTimeoutMs: 300 }).run();
    assert.equal(runner.ranTests, false);
    assert.ok(outcome.result.tests.every((test) => test.verdict === "blocked"));
    assert.deepEqual(outcome.result.addresses.find((address) => address.url === hung), { url: hung, answers: false, error: "TimeoutError" });
  });

  it("names every address that does not answer", async () => {
    const root = repository();
    const outcome = await runIn(root, new FakeRunner(root), down, downToo);
    assert.equal(outcome.result.tests[0]!.reason, `${down}, ${downToo} do not answer: no test was run.`);
  });
});

describe("criterion 4 — an address that answers with a status 500 answers", () => {
  it("runs the tests", async () => {
    const root = repository();
    const engine = new FakeRunner(root);
    const outcome = await runIn(root, engine, `${siteUrl}/broken`, `${siteUrl}/broken`);
    assert.equal(engine.ranTests, true);
    assert.ok(outcome.result.addresses.every((address) => address.answers));
  });
});

describe("criterion 5 — the verdicts of a recorded report of the real runner", () => {
  it("gives failed to the tests that failed, and not_run to a listed test the report lacks", async () => {
    const root = repository();
    const outcome = await runIn(root, new FakeRunner(root, { list: fixture("list-with-extra.json") }));
    assert.deepEqual(tally(outcome), { failed: 5, not_run: 1 });
    assert.match(outcome.result.tests[0]!.reason, /^Failed: (?!.*\u001b)/);
  });

  it("gives blocked to a network failure towards a declared address a check after the run finds down, and indeterminate otherwise", async () => {
    const api = `${siteUrl}/api`;
    const report = fixture("run.json").replaceAll(/Test timeout of 30000ms exceeded\./g, `page.goto: net::ERR_CONNECTION_REFUSED at ${siteUrl}/api/policies`);
    const unchecked = repository();
    const engine = new FakeRunner(unchecked, { report: { text: report } });
    const cannotCheck: CommandRunner = { run: (command) => (command.command[1] === "-e" && engine.ranTests ? Promise.resolve({ exitCode: 1, stdout: "", stderr: "node: out of memory" }) : engine.run(command)) };
    const notConfirmed = await new PinnedRun({ config: configFor(siteUrl, `${siteUrl}/api`), environment: "local", repositoryRoot: unchecked, tests: FILES, runner: cannotCheck, now: NOW }).run();
    assert.deepEqual(Object.keys(tally(notConfirmed)).sort(), ["failed", "indeterminate"]);
    const blockedRoot = repository();
    const blocked = await runIn(blockedRoot, new FakeRunner(blockedRoot, { report: { text: report }, downAfterRun: siteUrl }), siteUrl, api);
    assert.deepEqual(Object.keys(tally(blocked)).sort(), ["blocked", "failed"]);
    assert.deepEqual(blocked.result.addresses.at(-1), { url: siteUrl, answers: false });
    const answeringRoot = repository();
    const answering = await runIn(answeringRoot, new FakeRunner(answeringRoot, { report: { text: report } }), siteUrl, api);
    assert.deepEqual(Object.keys(tally(answering)).sort(), ["failed", "indeterminate"]);
  });
});

describe("criterion 5 — each line of the mapping, from a report of the real runner", () => {
  it("gives passed, failed, skipped, and indeterminate to a flaky test and to one expected to fail", async () => {
    const root = repository();
    const outcome = await runIn(root, new FakeRunner(root, { list: fixture("statuses.json"), report: { fixture: "statuses.json" } }));
    const byTitle = Object.fromEntries(outcome.result.tests.map((test) => [test.id.split(" › ").at(-1), test.verdict]));
    assert.deepEqual(byTitle, { passes: "passed", fails: "failed", "is skipped": "skipped", "is flaky": "indeterminate", "is expected to fail": "indeterminate", "times out": "failed", "passes inside": "passed" });
    assert.ok(outcome.result.tests.some((test) => test.id.includes(" › a group › passes inside")));
  });
});

describe("criterion 6 — without a readable JSON of the reporter, no test is passed", () => {
  it("gives indeterminate when the JSON is missing, empty or unreadable, and keeps the output of the runner", async () => {
    for (const report of ["none", { text: "" }, { text: "{ not json" }] as const) {
      const root = repository();
      const outcome = await runIn(root, new FakeRunner(root, { report }));
      assert.ok(outcome.result.tests.length > 0 && outcome.result.tests.every((test) => test.verdict === "indeterminate"), JSON.stringify(report));
      assert.equal(outcome.result.runnerOutput, ".oqas/runs/run-2026-11-13T12-00-00-000Z/runner-output.txt");
      assert.equal(outcome.result.report, undefined);
      assert.match(readFileSync(join(root, outcome.result.runnerOutput!), "utf8"), /Running 5 tests/);
    }
  });
});

describe("criterion 7 — an exit code 0 with an unexpected test gives failed", () => {
  it("reads the verdict from the JSON, and records the exit code", async () => {
    const root = repository();
    const outcome = await runIn(root, new FakeRunner(root, { runExit: 0 }));
    assert.equal(outcome.result.runnerExitCode, 0);
    assert.ok(outcome.result.tests.every((test) => test.verdict === "failed"));
  });
});

describe("criterion 8 — the result is written to the test repository, and nothing is committed", () => {
  it("holds each test with its verdict and reason, the version, the addresses and the exit code; HEAD and the remotes are unchanged", async () => {
    const root = repository();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    const before = [git("rev-parse", "HEAD"), git("for-each-ref", "refs/remotes")];
    const outcome = await runIn(root, new FakeRunner(root));
    assert.deepEqual([git("rev-parse", "HEAD"), git("for-each-ref", "refs/remotes")], before);
    const written = JSON.parse(readFileSync(outcome.resultPath, "utf8")) as RunOutcome["result"];
    assert.equal(outcome.resultPath, join(root, ".oqas", "runs", "run-2026-11-13T12-00-00-000Z.json"));
    assert.deepEqual(
      [written.playwright, written.runnerExitCode, written.report, written.addresses.length],
      ["1.64.1", 1, ".oqas/runs/run-2026-11-13T12-00-00-000Z/report.json", 2],
    );
    assert.ok(written.tests.length > 0);
    assert.deepEqual(written.tests, outcome.result.tests);
    assert.ok(written.tests.every((test) => test.id.startsWith("policy-management › ") && test.verdict === "failed" && test.reason.startsWith("Failed: ")));
  });
});

describe("criterion 12 — the base of the test repository", () => {
  it("declares a project per application, and imports only @playwright/test and modules of Node.js", async () => {
    const files = testRepositoryBase("1.64.1");
    const manifest = JSON.parse(files.find((file) => file.path === "package.json")!.content) as { devDependencies: Record<string, string> };
    assert.deepEqual(manifest.devDependencies, { "@playwright/test": "1.64.1" });
    const source = files.find((file) => file.path === "playwright.config.ts")!.content;
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(imports.filter((module) => module !== "@playwright/test" && !module!.startsWith("node:")), []);
    const root = mkdtempSync(join(workspace, "base-"));
    mkdirSync(join(root, "node_modules", "@playwright", "test"), { recursive: true });
    writeFileSync(join(root, "node_modules", "@playwright", "test", "package.json"), JSON.stringify({ name: "@playwright/test", type: "module", exports: "./index.js" }));
    writeFileSync(join(root, "node_modules", "@playwright", "test", "index.js"), "export const defineConfig = (config) => config;\n");
    for (const file of files) writeFileSync(join(root, file.path), file.content);
    const config = { applications: ["shop", "back-office"].map((id) => ({ id, environments: [{ name: "local", uiUrl: `http://${id}.test` }] })), repository: { appsDir: "tests" } };
    writeFileSync(join(root, "oqas.json"), JSON.stringify(config));
    process.env["OQAS_ENVIRONMENT"] = "local";
    process.env[baseUrlVariable("back-office")] = "http://seen-from-the-container:3020";
    try {
      const loaded = ((await import(join(root, "playwright.config.ts"))) as { default: { outputDir: string; projects: { name: string; testDir: string; use: { baseURL?: string } }[] } }).default;
      assert.equal(loaded.outputDir, join(".oqas", "test-results"));
      assert.deepEqual(loaded.projects, [
        { name: "shop", testDir: "tests/shop", use: { baseURL: "http://shop.test" } },
        { name: "back-office", testDir: "tests/back-office", use: { baseURL: "http://seen-from-the-container:3020" } },
      ]);
    } finally {
      delete process.env["OQAS_ENVIRONMENT"];
      delete process.env[baseUrlVariable("back-office")];
    }
  });
});

describe("the JSON of the reporter", () => {
  it("is not a report when it is no object with suites", () => {
    assert.equal(listedTests("{}"), undefined);
    for (const text of ["", "null", "[]", "{}", '{"suites":1}']) assert.equal(reportedTests(text), undefined, text);
  });
});

describe("a check of the addresses that cannot run", () => {
  it("runs no test, and gives each file not_run with the reason, rather than blocked", async () => {
    const root = repository();
    const engine = new FakeRunner(root);
    const broken: CommandRunner = { run: (command) => (command.command[1] === "-e" ? Promise.resolve({ exitCode: 127, stdout: "", stderr: "" }) : engine.run(command)) };
    const outcome = await new PinnedRun({ config: configFor(siteUrl), environment: "local", repositoryRoot: root, tests: FILES, runner: broken }).run();
    assert.equal(engine.ranTests, false);
    assert.deepEqual(outcome.result.tests.map((test) => [test.verdict, test.reason]), FILES.map(() => ["not_run", "The addresses could not be checked: exit code 127."]));
  });

  it("calls nothing for an environment without addresses", async () => {
    const root = repository();
    const engine = new FakeRunner(root);
    const outcome = await new PinnedRun({ config: configFor(siteUrl), environment: "staging", repositoryRoot: root, tests: FILES, runner: engine, now: NOW }).run();
    assert.deepEqual(outcome.result.addresses, []);
    assert.equal(engine.ranTests, true);
  });
});

describe("the reported tests", () => {
  it("read errors without a message as none, a suite without a title, and a test without errors", () => {
    const report = { suites: [{ title: "a.spec.ts", file: "a.spec.ts", suites: [{ specs: [{ title: "t", file: "a.spec.ts", line: 3, tests: [{ projectName: "p", status: "unexpected", expectedStatus: "passed", results: [{ status: "failed", errors: [{}, { message: "m" }] }, { status: "failed" }] }] }] }] }] };
    assert.deepEqual(reportedTests(JSON.stringify(report)), [{ id: "p › a.spec.ts:3 ›  › t", status: "unexpected", expectedStatus: "passed", attempts: [{ status: "failed", errors: ["m"] }, { status: "failed", errors: [] }] }]);
  });
});

describe("the local runner", () => {
  it("runs a command in the test repository, with the variables of the step, and returns its exit code", async () => {
    const root = mkdtempSync(join(workspace, "local-"));
    const runner = new LocalRunner(root);
    const outcome = await runner.run({ command: [process.execPath, "-e", "console.log(process.cwd(), process.env.STEP); process.exit(3)"], env: { STEP: "one" }, timeoutMs: 10_000 });
    assert.deepEqual([outcome.exitCode, outcome.stdout.trim()], [3, `${realpathSync(root)} one`]);
    const plain = await runner.run({ command: [process.execPath, "-e", "process.stderr.write('x')"], timeoutMs: 10_000 });
    assert.deepEqual([plain.exitCode, plain.stderr], [0, "x"]);
  });

  it("stops a command past its time limit, and throws for a program that does not exist", async () => {
    const runner = new LocalRunner(workspace);
    assert.equal((await runner.run({ command: [process.execPath, "-e", "setTimeout(() => {}, 10_000)"], timeoutMs: 200 })).exitCode, 124);
    await assert.rejects(runner.run({ command: [join(workspace, "no-such-program")], timeoutMs: 1000 }), /no-such-program cannot be called/);
  });
});

describe("the run on the machine", () => {
  it("installs with the real npm by default, and gives not_run when it cannot", async () => {
    // A lockfile without package.json: npm refuses at once, without calling the registry.
    const root = repository();
    const outcome = await new PinnedRun({ config: configFor(siteUrl), environment: "local", repositoryRoot: root, tests: FILES, now: NOW }).run();
    assert.deepEqual(outcome.result.tests.map((test) => test.verdict), ["not_run", "not_run"]);
    assert.match(outcome.result.tests[0]!.reason, /^The dependencies could not be installed: npm/);
  });
});

describe("the trial of a test file", () => {
  const TRIED = { path: "apps/shop/steps.spec.ts", content: "// the test\n" };
  const trialRunner = (root: string, runner: CommandRunner) => new TrialRunner({ config: configFor(siteUrl), environment: "local", repositoryRoot: root, runner, now: NOW, reachTimeoutMs: 2000 });

  it("writes the file for its run only, runs it alone, and gives the whole error, the failed step and the trace", async () => {
    const root = repository();
    const fake = new FakeRunner(root, { list: fixture("steps.json"), report: { fixture: "steps.json" } });
    let present = false;
    const runner: CommandRunner = { run: (command) => ((present ||= command.command.includes("--reporter=json") && existsSync(join(root, TRIED.path))), fake.run(command)) };
    const trial = await trialRunner(root, runner).run(TRIED);
    assert.equal(present, true);
    assert.equal(existsSync(join(root, TRIED.path)), false);
    assert.equal(trial.startedAt, "2026-11-13T12:00:00.000Z");
    const [tried] = trial.tests;
    // The recorded trace lies outside this repository: it is given as the runner wrote it, relative to the test repository.
    assert.deepEqual([tried!.verdict, tried!.failedStep], ["failed", "check the total › read the cell"]);
    assert.match(tried!.trace!, /out\/steps-fails-in-a-step-shop\/trace\.zip$/);
    assert.match(tried!.reason, /^Error: the total of the list\n\nexpect\(received\)\.toBe\(expected\)/);
    assert.ok(fake.commands.filter((command) => command.command[1] === "test").every((command) => command.command.at(-1) === TRIED.path));
  });

  it("prepares once for every trial, and gives a trace relative to the test repository", async () => {
    const root = repository();
    const fake = new FakeRunner(root, { list: fixture("steps.json"), report: { text: fixture("steps.json").replaceAll("/repo/out/", `${root}/.oqas/test-results/`) } });
    const runner = trialRunner(root, fake);
    const first = await runner.run(TRIED);
    await runner.run(TRIED);
    assert.equal(fake.commands.filter((command) => command.command[0] === "npm").length, 1);
    assert.equal(first.tests[0]!.trace, ".oqas/test-results/steps-fails-in-a-step-shop/trace.zip");
  });

  it("gives a passed test as it is, and says why a file cannot run", async () => {
    const root = repository();
    const passed = await trialRunner(root, new FakeRunner(root, { list: fixture("statuses.json"), report: { fixture: "statuses.json" } })).run(TRIED);
    assert.deepEqual(passed.tests.find((test) => test.id.endsWith(" › passes")), { id: passed.tests.find((test) => test.id.endsWith(" › passes"))!.id, verdict: "passed", reason: "Every attempt passed." });
    const noLock = repository(null);
    assert.match((await trialRunner(noLock, new FakeRunner(noLock)).run(TRIED)).error!, /package-lock\.json/);
    const taken = repository();
    mkdirSync(join(taken, "apps", "shop"), { recursive: true });
    writeFileSync(join(taken, TRIED.path), "// kept\n");
    const refused = await trialRunner(taken, new FakeRunner(taken)).run(TRIED);
    assert.deepEqual([refused.tests, refused.error, readFileSync(join(taken, TRIED.path), "utf8")], [[], "apps/shop/steps.spec.ts already exists in the test repository; give the test another file name.", "// kept\n"]);
    const listFails = repository();
    const unlisted = await trialRunner(listFails, new FakeRunner(listFails, { listExit: 1 })).run(TRIED);
    assert.deepEqual(unlisted.tests.map((test) => [test.id, test.verdict]), [[TRIED.path, "not_run"]]);
  });
});

describe("the trial of a test without an error message", () => {
  it("keeps the reason of the harness, and dates the trial with the system clock", async () => {
    const root = repository();
    const report = JSON.parse(fixture("steps.json")) as { suites: { specs: { tests: { results: { errors: unknown[]; steps: unknown[]; attachments: unknown[] }[] }[] }[] }[] };
    const result = report.suites[0]!.specs[0]!.tests[0]!.results[0]!;
    result.errors = [];
    result.steps = [];
    result.attachments = [];
    const fake = new FakeRunner(root, { list: fixture("steps.json"), report: { text: JSON.stringify(report) } });
    const before = Date.now();
    const trial = await new TrialRunner({ config: configFor(siteUrl), environment: "local", repositoryRoot: root, runner: fake }).run({ path: "apps/shop/steps.spec.ts", content: "// t\n" });
    assert.ok(Date.parse(trial.startedAt) >= before - 1000);
    assert.deepEqual([trial.tests[0]!.verdict, trial.tests[0]!.reason, "failedStep" in trial.tests[0]!, "trace" in trial.tests[0]!], ["failed", "Failed, without an error message.", false, false]);
  });
});

describe("the trials, one at a time", () => {
  it("never runs two trials at once, even when they are asked together, and goes on after one that throws", async () => {
    const root = repository();
    const fake = new FakeRunner(root, { list: fixture("steps.json"), report: { fixture: "steps.json" } });
    let running = 0;
    let most = 0;
    let calls = 0;
    const counted: CommandRunner = {
      run: async (command) => {
        if (command.command.includes("--list") && (calls += 1) === 1) throw new Error("the runner cannot be called");
        running += 1;
        most = Math.max(most, running);
        try {
          return await fake.run(command);
        } finally {
          running -= 1;
        }
      },
    };
    const trials = new TrialRunner({ config: configFor(siteUrl), environment: "local", repositoryRoot: root, runner: counted, now: NOW });
    const [first, ...rest] = await Promise.allSettled(["a", "b", "c"].map((name) => trials.run({ path: `apps/shop/${name}.spec.ts`, content: `// ${name}\n` })));
    assert.equal(first!.status, "rejected");
    assert.ok(rest.every((outcome) => outcome.status === "fulfilled"));
    assert.equal(most, 1);
  });

  it("gives the errors of the last attempt, every one of them, with its step and its trace", async () => {
    const root = repository();
    const report = JSON.parse(fixture("steps.json")) as { suites: { specs: { tests: { results: Record<string, unknown>[] }[] }[] }[] };
    const results = report.suites[0]!.specs[0]!.tests[0]!.results;
    results.push({ status: "failed", errors: [{ message: "Error: the second try" }, { message: "Error: and its second error" }], steps: [{ title: "open the list", error: {} }], attachments: [{ name: "trace", path: join(root, ".oqas", "second", "trace.zip") }] });
    const fake = new FakeRunner(root, { list: fixture("steps.json"), report: { text: JSON.stringify(report) } });
    const trial = await new TrialRunner({ config: configFor(siteUrl), environment: "local", repositoryRoot: root, runner: fake, now: NOW }).run({ path: "apps/shop/steps.spec.ts", content: "// t\n" });
    assert.deepEqual([trial.tests[0]!.reason, trial.tests[0]!.failedStep, trial.tests[0]!.trace], ["Error: the second try\n\nError: and its second error", "open the list", join(".oqas", "second", "trace.zip")]);
    const run = fake.commands.find((command) => command.command[1] === "test" && !command.command.includes("--list"))!;
    assert.ok(run.command.some((part) => /^--output=\.oqas\/trials\/trial-.*-1\/test-results$/.test(part)));
  });
});

describe("the environment of the tests", () => {
  it("holds the variables of the test accounts, read from the environment given", async () => {
    const text = JSON.stringify({
      formatVersion: 1,
      applications: [{ id: "shop", name: "Shop", type: "web", authentication: { method: "form", accounts: [{ name: "demo", usernameEnv: "SHOP_USER", passwordEnv: "SHOP_PASSWORD" }] }, environments: [{ name: "local", uiUrl: siteUrl }] }],
      knowledge: [],
      model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: "m", apiKeyEnv: "MODEL_KEY" },
      autonomy: { level: "autonomous" },
    });
    const env = { SHOP_USER: "max", SHOP_PASSWORD: "pw", MODEL_KEY: "sk-1" };
    const config = validateConfig(text, env);
    assert.ok(config.ok);
    const root = repository();
    const runner = new FakeRunner(root);
    await new PinnedRun({ config: config.config, environment: "local", repositoryRoot: root, tests: FILES, runner, env, now: NOW }).run();
    assert.deepEqual([runner.commands[0]!.env!["SHOP_USER"], runner.commands[0]!.env!["SHOP_PASSWORD"], runner.commands[0]!.env!["MODEL_KEY"]], ["max", "pw", undefined]);
    const partial = new FakeRunner(root);
    await new PinnedRun({ config: config.config, environment: "local", repositoryRoot: root, tests: FILES, runner: partial, env: { SHOP_USER: "max" }, now: () => new Date("2026-11-13T12:00:01.000Z") }).run();
    assert.deepEqual(["SHOP_USER" in partial.commands[0]!.env!, "SHOP_PASSWORD" in partial.commands[0]!.env!], [true, false]);
  });

  it("leaves out of a command every variable of the process that npm, the runner and the browsers do not need", async () => {
    process.env["OQAS_TEST_SECRET"] = "sk-secret";
    try {
      const outcome = await new LocalRunner(workspace).run({ command: [process.execPath, "-e", "console.log(JSON.stringify([process.env.OQAS_TEST_SECRET ?? null, typeof process.env.PATH, process.env.STEP]))"], env: { STEP: "kept" }, timeoutMs: 10_000 });
      assert.deepEqual(JSON.parse(outcome.stdout), [null, "string", "kept"]);
    } finally {
      delete process.env["OQAS_TEST_SECRET"];
    }
  });
});

describe("the references of a visual test, at its trial", () => {
  it("are made at the first run, then the file runs again against them; they are given and removed from the folder", async () => {
    const root = repository();
    const fake = new FakeRunner(root, { list: fixture("steps.json"), report: { fixture: "statuses.json" } });
    const runner: CommandRunner = {
      run: async (command) => {
        if (command.command.includes("--update-snapshots=missing")) {
          mkdirSync(join(root, "apps", "shop", "look.spec.ts-snapshots", "nested"), { recursive: true });
          writeFileSync(join(root, "apps", "shop", "look.spec.ts-snapshots", "look-1-shop.png"), "png");
          writeFileSync(join(root, "apps", "shop", "look.spec.ts-snapshots", "nested", "look-2-shop.png"), "png2");
        }
        return fake.run(command);
      },
    };
    const trial = await new TrialRunner({ config: configFor(siteUrl), environment: "local", repositoryRoot: root, runner, now: NOW }).run({ path: "apps/shop/look.spec.ts", content: "// t\n" });
    assert.deepEqual(trial.references?.map((reference) => [reference.path, Buffer.from(reference.content).toString()]), [["apps/shop/look.spec.ts-snapshots/look-1-shop.png", "png"], ["apps/shop/look.spec.ts-snapshots/nested/look-2-shop.png", "png2"]]);
    const runs = fake.commands.filter((command) => command.command[1] === "test" && !command.command.includes("--list"));
    assert.deepEqual(runs.map((command) => command.command.includes("--update-snapshots=missing")), [true, false]);
    assert.equal(existsSync(join(root, "apps", "shop", "look.spec.ts-snapshots")), false);
  });

  it("are not taken from a folder of references that was there before", async () => {
    const root = repository();
    mkdirSync(join(root, "apps", "shop", "look.spec.ts-snapshots"), { recursive: true });
    writeFileSync(join(root, "apps", "shop", "look.spec.ts-snapshots", "kept.png"), "kept");
    const fake = new FakeRunner(root, { list: fixture("steps.json"), report: { fixture: "statuses.json" } });
    const trial = await new TrialRunner({ config: configFor(siteUrl), environment: "local", repositoryRoot: root, runner: fake, now: NOW }).run({ path: "apps/shop/look.spec.ts", content: "// t\n" });
    assert.equal(trial.references, undefined);
    assert.equal(readFileSync(join(root, "apps", "shop", "look.spec.ts-snapshots", "kept.png"), "utf8"), "kept");
  });
});

describe("the preparation of the trials", () => {
  it("installs once, before any trial, and gives the version installed", async () => {
    const root = repository();
    const fake = new FakeRunner(root, { list: fixture("steps.json"), report: { fixture: "steps.json" } });
    const trials = new TrialRunner({ config: configFor(siteUrl), environment: "local", repositoryRoot: root, runner: fake, now: NOW });
    assert.deepEqual(await trials.prepare(), { ok: true, version: "1.64.1" });
    await trials.run({ path: "apps/shop/steps.spec.ts", content: "// t\n" });
    assert.equal(fake.commands.filter((command) => command.command[0] === "npm").length, 1);
  });
});
