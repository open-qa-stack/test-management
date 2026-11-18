import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";

import "../src/loopback-only.ts";
import * as fixture from "../src/fixture-repository.ts";
import {
  boundedTo,
  chain,
  configText,
  ended,
  FakeRunner,
  FIRST_RUN,
  git,
  IDS,
  isFinalRun,
  later,
  MODEL,
  offered,
  plan,
  planned,
  read,
  report,
  repository,
  scenario,
  site,
  siteUrl,
  spec,
  submit,
  tried,
  untracked,
  WITNESS,
  workspace,
  written,
} from "../src/test-repository/index.ts";

/** The results of the test files of a report, as their status and their errors. */
function reported(text: string): unknown {
  const { suites } = JSON.parse(text) as { suites: { file: string; specs: { tests: { status: string; results: unknown }[] }[] }[] };
  return suites.map((suite) => [suite.file, suite.specs[0]!.tests[0]!.status, suite.specs[0]!.tests[0]!.results]);
}

describe("the test repository of a run", () => {
  it("is a git repository with a commit and a remote, a Playwright project, and the configuration it is given", async () => {
    const config = configText("http://127.0.0.1:1/v1");
    const root = repository(config);
    assert.ok(root.startsWith(workspace));
    assert.equal(readFileSync(join(root, "oqas.json"), "utf8"), config);
    assert.equal(git(root, "log", "--format=%s"), "chore: start the test repository");
    assert.equal(git(root, "status", "--porcelain"), "");
    assert.match(git(root, "remote", "get-url", "origin"), /remote-/);
    assert.ok(existsSync(join(root, "playwright.config.ts")));
    assert.ok(existsSync(join(root, "node_modules", "@playwright", "test", "index.d.ts")));
    writeFileSync(join(root, "notes.txt"), "x");
    assert.equal(untracked(root), "?? notes.txt");
  });

  it("has no configuration when it is given none", () => {
    assert.equal(existsSync(join(repository(undefined), "oqas.json")), false);
  });

  it("targets the application the tests serve, with the model it is given, and takes changes to its configuration", async () => {
    assert.ok(site.listening);
    assert.equal(await (await fetch(siteUrl)).text(), "ok");
    const config = JSON.parse(configText("http://127.0.0.1:1/v1")) as {
      model: { baseUrl: string; model: string };
      applications: { environments: { apis: { baseUrl: string }[] }[] }[];
      knowledge: { connectionStringEnv?: string }[];
    };
    assert.deepEqual(config.model, { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: MODEL } as never);
    assert.equal(config.applications[0]!.environments[0]!.apis[0]!.baseUrl, siteUrl);
    assert.equal(config.knowledge[1]!.connectionStringEnv, "SHOP_DB_URL");
    assert.match(WITNESS, /^postgresql:/);
    const bounded = JSON.parse(boundedTo(2)("http://127.0.0.1:1/v1")) as { autonomy: unknown };
    assert.deepEqual(bounded.autonomy, { level: "bounded", task: { maxIterations: 2 } });
  });
});

describe("the test repository of a host the test runner does not serve", () => {
  it("is made where it is told, for the application it is told, with the replies and the doubles of every host", () => {
    const config = fixture.fixtureConfig("http://127.0.0.1:1/v1", "http://127.0.0.1:2");
    const root = fixture.fixtureRepository(workspace, config);
    assert.ok(root.startsWith(workspace));
    assert.equal(readFileSync(join(root, "oqas.json"), "utf8"), config);
    assert.match(config, /"baseUrl":"http:\/\/127\.0\.0\.1:2"/);
    assert.deepEqual([fixture.chain().length, fixture.MODEL, fixture.WITNESS, fixture.FakeRunner], [chain().length, MODEL, WITNESS, FakeRunner]);
  });
});

describe("the replies scripted for the whole chain", () => {
  it("are the check of the server, the cartography, the plan, then the session of each scenario", () => {
    const replies = chain();
    assert.equal(replies.length, 9 + 3 * IDS.length + 4);
    assert.deepEqual(replies[0], { body: { data: [] } });
    assert.equal(replies[7], planned);
    assert.equal(replies[8], ended);
    assert.deepEqual(replies.slice(9, 12), written("test-1"));
    assert.deepEqual(offered({ tools: [{ function: { name: "run_test" } }, { function: { name: "propose_test" } }] }), ["run_test", "propose_test"]);
  });

  it("plan three scenarios, the last one negative, each with a test of its own", () => {
    assert.deepEqual(plan, submit("propose_plan", { scenarios: IDS.map(scenario) }, "plan"));
    assert.deepEqual(
      IDS.map((id) => scenario(id).case),
      ["nominal", "nominal", "negative"],
    );
    assert.match(spec("test-1"), /^import \{ test, expect \}.*\n\ntest\("test-1"/);
    assert.notDeepEqual(read(), read("again"));
  });

  it("are dated by a clock held at an hour of one day, which names the run", () => {
    assert.equal(later(12)().toISOString(), "2026-11-13T12:00:00.000Z");
    assert.equal(FIRST_RUN, "oqas-2026-11-13T12-00-00-000Z");
    assert.equal(later(13)().toISOString(), "2026-11-13T13:00:00.000Z");
  });
});

describe("the report of the test runner", () => {
  it("gives each file one test with the status scripted for it: passed, failed with an error, or skipped", () => {
    assert.deepEqual(reported(report(["a.spec.ts"])), [["a.spec.ts", "expected", [{ status: "passed", errors: [] }]]]);
    const status = (file: string) => (file === "a.spec.ts" ? "unexpected" : "skipped");
    assert.deepEqual(reported(report(["a.spec.ts", "b.spec.ts"], status)), [
      ["a.spec.ts", "unexpected", [{ status: "failed", errors: [{ message: "Error: the total is wrong" }] }]],
      ["b.spec.ts", "skipped", [{ status: "skipped", errors: [] }]],
    ]);
    assert.deepEqual(reported(report(["a.spec.ts"], () => "unexpected", "Error: boom")), [
      ["a.spec.ts", "unexpected", [{ status: "failed", errors: [{ message: "Error: boom" }] }]],
    ]);
  });
});

describe("the doubles of npm and Playwright", () => {
  const npm = (...args: string[]) => ({ command: ["npm", ...args] });
  const playwright = (...args: string[]) => ({ command: ["npx", "test", ...args], env: { PLAYWRIGHT_JSON_OUTPUT_FILE: "out/report.json" } });

  it("answer npm as a machine that has it, and keep each command they were asked", async () => {
    const runner = new FakeRunner(repository(undefined));
    assert.deepEqual(await runner.run(npm("--version")), { exitCode: 0, stdout: "11.0.0\n", stderr: "" });
    assert.deepEqual(await runner.run(npm("ci")), { exitCode: 0, stdout: "", stderr: "" });
    assert.deepEqual(await runner.run({ command: ["node", "-p", "version"] }), { exitCode: 0, stdout: "1.64.1\n", stderr: "" });
    assert.deepEqual(await runner.run({ command: ["npx", "install", "chromium"] }), { exitCode: 0, stdout: "", stderr: "" });
    assert.deepEqual(
      runner.commands.map((step) => step.command.join(" ")),
      ["npm --version", "npm ci", "node -p version", "npx install chromium"],
    );
  });

  it("answer npm as scripted when it is missing, fails to install, or cannot be called", async () => {
    const root = repository(undefined);
    assert.deepEqual(await new FakeRunner(root, { npm: 127 }).run(npm("--version")), { exitCode: 127, stdout: "", stderr: "npm: not found" });
    assert.deepEqual(await new FakeRunner(root, { install: 1 }).run(npm("ci")), { exitCode: 1, stdout: "", stderr: "npm error 404 Not Found\n" });
    assert.deepEqual(await new FakeRunner(root, { install: 1, installError: "no lockfile" }).run(npm("ci")), {
      exitCode: 1,
      stdout: "",
      stderr: "no lockfile",
    });
    await assert.rejects(new FakeRunner(root, { installCrash: true }).run(npm("ci")), { message: "spawn npm EACCES" });
  });

  it("run the scripts of Node.js for real, and say how they ended", async () => {
    const runner = new FakeRunner(repository(undefined));
    assert.deepEqual(await runner.run({ command: ["node", "-e", "console.log(process.argv[1])", "given"] }), { exitCode: 0, stdout: "given\n", stderr: "" });
    assert.equal((await runner.run({ command: ["node", "-e", "process.exit(3)"] })).exitCode, 1);
  });

  it("list the test files, try each as passing, then run them at the end with the statuses scripted", async () => {
    const root = repository(undefined);
    const runner = new FakeRunner(root, { final: (file) => (file === "b.spec.ts" ? "unexpected" : "expected"), finalError: "Error: late" });
    assert.deepEqual(reported((await runner.run(playwright("--list", "a.spec.ts"))).stdout), [["a.spec.ts", "expected", [{ status: "passed", errors: [] }]]]);
    const written = () => reported(readFileSync(join(root, "out", "report.json"), "utf8"));
    await runner.run(playwright("--update-snapshots=missing", "b.spec.ts"));
    assert.deepEqual(written(), [["b.spec.ts", "expected", [{ status: "passed", errors: [] }]]]);
    assert.equal(runner.finalRuns, 0);
    await runner.run(playwright("a.spec.ts", "b.spec.ts"));
    assert.deepEqual(written(), [
      ["a.spec.ts", "expected", [{ status: "passed", errors: [] }]],
      ["b.spec.ts", "unexpected", [{ status: "failed", errors: [{ message: "Error: late" }] }]],
    ]);
    assert.equal(runner.finalRuns, 1);
    assert.deepEqual(runner.commands.map(isFinalRun), [false, false, true]);
    assert.deepEqual(tried(runner), ["b.spec.ts"]);
    const plain = new FakeRunner(root);
    await plain.run(playwright("a.spec.ts"));
    assert.deepEqual(written(), [["a.spec.ts", "expected", [{ status: "passed", errors: [] }]]]);
  });

  it("answer that the declared addresses are down once the design is over, when scripted so", async () => {
    const runner = new FakeRunner(repository(undefined), { downAfterDesign: true });
    const check = { command: ["node", "-e", "console.log('[]')", "--", "http://127.0.0.1:1"] };
    assert.equal((await runner.run(check)).stdout, "[]\n");
    await runner.run(playwright("--list", "a.spec.ts"));
    assert.equal((await runner.run(check)).stdout, "[]\n", "one file listed is a trial, not the end of the design");
    await runner.run(playwright("--list", "a.spec.ts", "b.spec.ts"));
    assert.deepEqual(JSON.parse((await runner.run(check)).stdout), [{ url: "http://127.0.0.1:1", answers: false, error: "ECONNREFUSED" }]);
  });
});
