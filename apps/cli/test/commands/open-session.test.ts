import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import type { SessionEvent } from "@open-qa-stack/domain/sessions";
import { runOqas, USAGE } from "../../src/index.ts";
import { chain, configText, sessionOf, siteUrl, Terminal, untracked, workspace } from "../support/terminal.ts";

const BRIEF = ["--environment", "local", "--brief", "tester la recherche d'un client"];

let terminal: Terminal;
afterEach(() => terminal.close());

describe("oqas --brief", () => {
  it("opens a session, runs it and follows it to its end: what the harness tells on the error output, what it came to on the standard one", async () => {
    terminal = await Terminal.open(chain());
    const run = await terminal.oqas(BRIEF);
    assert.equal(run.code, 0, run.err);
    const id = sessionOf(run.err);
    const lines = run.err.split("\n");
    assert.equal(lines[0], `Session ${id}`);
    assert.match(String(lines[1]), /^\d\d:\d\d:\d\d person: tester la recherche d'un client$/);
    assert.deepEqual(lines.slice(2, 6), [lines[2]?.replace(/.*/, `${lines[2].slice(0, 8)} session running`), "[configuration] started", lines[4], lines[5]]);
    assert.match(String(lines[4]), /^\[configuration\] scope: environment local; applications [a-z-]+(, [a-z-]+)*; levels [a-z-]+(, [a-z-]+)*$/);
    assert.match(String(lines[5]), /^\[configuration\] The configuration is valid; the run targets the environment local\.$/);
    assert.match(run.err, /^\[plan\] The plan was accepted: test-1, test-2, test-3\.$/m);
    assert.match(run.err, /^\d\d:\d\d:\d\d scenario test-1 closed: passed$/m);
    assert.match(String(lines.at(-2)), /^\d\d:\d\d:\d\d session completed$/);
    // Without --follow, nothing of what the agents do is printed.
    assert.doesNotMatch(run.err, / -> | <- |harness to the /);
    const summary = run.out.split("\n");
    assert.match(String(summary[0]), new RegExp(`^Session ${id}: completed, passed, in [\\d.]+ s and 17 model requests\\.$`));
    assert.match(String(summary[1]), /^Tests written on the branch oqas\/design-\d{8}T\d{6}Z\.$/);
    assert.deepEqual(
      summary.slice(2),
      ["test-1", "test-2", "test-3"].map((test) => `passed        shop › shop/tests/orders/listing/${test}.spec.ts:3 › the test`).concat(""),
    );
    // The brief went to the agent that plans.
    assert.ok(
      terminal.server.requests.some((request) => (JSON.stringify(request.body) ?? "").includes("<brief>\\ntester la recherche d'un client\\n</brief>")),
    );
  });

  it("keeps the session in the database of the test repository, and no file of its own: neither a journal, a state nor an inbox", async () => {
    terminal = await Terminal.open(chain());
    const run = await terminal.oqas(BRIEF);
    assert.equal(run.code, 0, run.err);
    assert.ok(existsSync(join(terminal.root, ".oqas", "oqas.db")));
    // The folder of the runs holds what Playwright wrote when the tests ran, and nothing named after the session or its run.
    assert.deepEqual(
      readdirSync(join(terminal.root, ".oqas", "runs")).filter((name) => !name.startsWith("run-")),
      [],
    );
    const listed = await terminal.oqas(["sessions", "--output", "json"]);
    assert.deepEqual(
      listed.out
        .trim()
        .split("\n")
        .map((line) => (JSON.parse(line) as { id: string; state: string }).state),
      ["completed"],
    );
  });

  it("prints what the agents do besides, when it is asked to follow", async () => {
    terminal = await Terminal.open(chain());
    const run = await terminal.oqas([...BRIEF, "--follow"]);
    assert.equal(run.code, 0, run.err);
    assert.match(run.err, /^\d\d:\d\d:\d\d planner -> propose_plan\(/m);
    assert.match(run.err, /^\d\d:\d\d:\d\d <- The plan is not closed yet\. It holds 3 scenarios: test-1, test-2, test-3\./m);
    assert.match(run.err, /^\d\d:\d\d:\d\d harness to the writer: Write the test of this scenario/m);
    assert.match(run.err, /^\d\d:\d\d:\d\d cartographer: One domain\.$/m);
    assert.equal(run.err.split("\n").filter((line) => line.includes("The plan was accepted:")).length, 1);
  });

  it("prints the thread as JSON Lines when asked: each event of the session on the standard output, and nothing else there", async () => {
    terminal = await Terminal.open(chain());
    const run = await terminal.oqas([...BRIEF, "--output", "json", "--no-input"]);
    assert.equal(run.code, 0, run.err);
    const id = sessionOf(run.err);
    assert.equal(run.err, `Session ${id}\n`);
    const events = run.out
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as SessionEvent);
    assert.deepEqual(
      events.map((event) => event.id),
      events.map((_, index) => index + 1),
    );
    assert.deepEqual(Object.keys(events[0]!), ["id", "at", "type", "text"]);
    assert.deepEqual(
      [events[0]?.type, events[1]?.type, events.at(-1)],
      ["user_message", "state_changed", { ...events.at(-1)!, type: "state_changed", state: "completed" }],
    );
    assert.ok(events.some((event) => event.type === "action_started") && events.some((event) => event.type === "agent_message"));
    assert.deepEqual(await terminal.thread(id), events);
  });
});

describe("the exit code of oqas --brief", () => {
  it("is 3 when the configuration stops the session, which tells why", async () => {
    terminal = await Terminal.open([]);
    const undeclared = await terminal.oqas(["--environment", "nowhere", "--brief", "Orders."]);
    assert.equal(undeclared.code, 3);
    assert.match(undeclared.err, /^\[configuration\] error: The environment nowhere is not declared; the configuration declares local, staging\.$/m);
    assert.equal(undeclared.out, `Session ${sessionOf(undeclared.err)}: interrupted.\n`);
    const unnamed = await terminal.oqas(["--brief", "Orders."]);
    assert.equal(unnamed.code, 3);
    assert.match(unnamed.err, /^\[configuration\] error: Several environments are declared \(local, staging\); name one with --environment\.$/m);
    assert.equal(terminal.server.requests.length, 0);
  });

  it("is 4 when a prerequisite is missing", async () => {
    terminal = await Terminal.open([], { script: { npm: 127 } });
    const run = await terminal.oqas(BRIEF);
    assert.equal(run.code, 4);
    assert.match(run.err, /^\[prerequisites\] error: npm cannot be run; it installs the dependencies of the test repository\.$/m);
  });

  it("is 1 when a test failed, and 2 when one has no verdict of success or failure", async () => {
    terminal = await Terminal.open(chain(), { script: { final: (file) => (file.includes("test-2") ? "unexpected" : "expected") } });
    const failed = await terminal.oqas(BRIEF);
    assert.equal(failed.code, 1, failed.err);
    assert.match(failed.out, /^Session \S+: completed, failed, /);
    assert.match(failed.out, /^failed        shop › shop\/tests\/orders\/listing\/test-2\.spec\.ts:3 › the test$/m);
    await terminal.close();
    terminal = await Terminal.open(chain(), { script: { final: () => "skipped" } });
    const skipped = await terminal.oqas(BRIEF);
    assert.equal(skipped.code, 2, skipped.err);
    assert.match(skipped.out, /^Session \S+: completed, inconclusive, /);
  });

  it("is 5 when the session did not go to its end: its run stopped on the way, with the runtime of the machine or one that cannot be opened", async () => {
    terminal = await Terminal.open(chain(), { script: { install: 1 } });
    const uninstalled = await terminal.oqas(BRIEF);
    assert.equal(uninstalled.code, 5);
    assert.match(uninstalled.out, /^Session \S+: completed, stopped, /);
    await terminal.close();
    terminal = await Terminal.open([{ body: { data: [] } }]);
    const io = { connect: () => Promise.reject(new Error("no runtime")), now: () => new Date("2026-11-13T12:00:00.000Z") };
    const closed = await terminal.oqas([...BRIEF, "--output", "json"], { io });
    assert.equal(closed.code, 5);
    const refusal = closed.out
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as SessionEvent)
      .find((event) => event.type === "refusal");
    // What the run tells is dated by the clock the command was given.
    assert.deepEqual(refusal, {
      id: refusal?.id,
      at: "2026-11-13T12:00:00.000Z",
      type: "refusal",
      phase: "survey",
      text: "The cartography stopped on an unexpected error: no runtime",
    });
  });
});

describe("oqas --brief in a folder it cannot keep its sessions in", () => {
  it("stops with 3 and writes nothing when the test repository holds no configuration to place its database by", async () => {
    terminal = await Terminal.open([], { config: () => undefined });
    const run = await terminal.oqas(["--brief", "Orders."]);
    assert.deepEqual(run, {
      code: 3,
      out: "",
      err: `${join(terminal.root, "oqas.json")} is missing. Start with oqas in a terminal or oqas --ui, which set it up step by step, or write a oqas.json at the root of the test repository.\n`,
    });
    assert.equal(untracked(terminal.root), "");
  });

  it("opens the session in the database it was given the URL of, where the run tells that the configuration is missing", async () => {
    terminal = await Terminal.open([], { config: () => undefined });
    const file = join(mkdtempSync(join(workspace, "elsewhere-")), "oqas.db");
    const env = { OQAS_DATABASE_URL: `sqlite:${file}` };
    const run = await terminal.oqas(["--brief", "Orders."], { env });
    assert.equal(run.code, 3);
    assert.match(run.err, /^\[configuration\] error: .*oqas\.json cannot be read, and the instance keeps no revision of the configuration\. /m);
    assert.ok(existsSync(file) && !existsSync(join(terminal.root, ".oqas")));
    assert.match((await terminal.oqas(["sessions"], { env })).out, /^session-\S+  interrupted  \S+  Orders\.\n$/);
  });

  it("stops with 3 when the URL of its database is none, and with 5 when its database cannot be opened, and says which", async () => {
    terminal = await Terminal.open([]);
    const wrong = await terminal.oqas(["--brief", "Orders."], { env: { OQAS_DATABASE_URL: "mysql://witness-7e1a@127.0.0.1/oqas" } });
    assert.deepEqual(wrong, {
      code: 3,
      out: "",
      err: "OQAS_DATABASE_URL must be a database URL: postgres:// or postgresql:// with a host name for a PostgreSQL server, or sqlite: followed by the path of a file.\n",
    });
    // A file stands where the folder of the database should be.
    const folder = mkdtempSync(join(workspace, "unopenable-"));
    writeFileSync(join(folder, "state"), "");
    const file = join(folder, "state", "oqas.db");
    const unopenable = await terminal.oqas(["sessions"], { env: { OQAS_DATABASE_URL: `sqlite:${file}` } });
    assert.equal(unopenable.code, 5);
    assert.match(unopenable.err, /^The database is unreachable: .*oqas\.db cannot be opened \(.+\)\.\n$/);
    const unreachable = await terminal.oqas(["sessions"], { env: { OQAS_DATABASE_URL: "postgres://oqas:witness-7e1a@127.0.0.1:1/oqas" } });
    assert.equal(unreachable.code, 5);
    assert.match(unreachable.err, /^oqas: The database is unreachable: .*\nThe database is unreachable: /);
    assert.ok(!unreachable.err.includes("witness-7e1a"));
  });

  it("exits with 5 on what is thrown around the session, even when it is no error", async () => {
    terminal = await Terminal.open([]);
    const thrown = (what: unknown) => ({
      write: () => {
        throw what;
      },
    });
    await terminal.oqas(["--environment", "nowhere", "--brief", "Orders."]);
    let err = "";
    const io = { stderr: { write: (text: string) => (err += text) } };
    assert.equal((await terminal.oqas(["sessions"], { io: { ...io, stdout: thrown(new Error("the output is closed")) } })).code, 5);
    assert.equal((await terminal.oqas(["sessions"], { io: { ...io, stdout: thrown("closed") } })).code, 5);
    assert.equal(err, "oqas stopped on an unexpected error: the output is closed\noqas stopped on an unexpected error: closed\n");
  });
});

describe("the test repository of oqas", () => {
  it("is the folder the command runs in when none is named, as a program too", async () => {
    terminal = await Terminal.open([]);
    const single = configText(terminal.server.baseUrl, {
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
    writeFileSync(join(terminal.root, "oqas.json"), single);
    let err = "";
    const code = await runOqas(["--brief", "Orders."], {
      env: {},
      cwd: terminal.root,
      stdout: { write: () => true },
      stderr: { write: (text) => (err += text) },
      runner: { run: async () => ({ exitCode: 127, stdout: "", stderr: "npm: not found" }) },
    });
    assert.equal(code, 4, err);
    assert.match(err, /the run targets the environment local\./);
    // With what the machine gives and nothing else: the usage, a refusal, and the sessions the folder holds.
    let out = "";
    const io = { env: {}, cwd: terminal.root, stdout: { write: (text: string) => (out += text) }, stderr: { write: (text: string) => (err += text) } };
    assert.equal(await runOqas(["sessions"], io), 0);
    assert.match(out, /^session-\S+  interrupted  \S+  Orders\.\n$/);
    assert.equal(await runOqas(["--help"], io), 0);
    assert.ok(out.endsWith(USAGE));
    assert.equal(await runOqas(["--push"], io), 3);
    assert.ok(err.endsWith("Unknown option --push; see oqas --help.\n"));
  });
});
