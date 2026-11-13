import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@open-qa-stack/shared";
import { answer, scriptedServer } from "@open-qa-stack/testing";
import { AgentRuntimeError, type AgentEvent, type AgentRuntime } from "@open-qa-stack/domain";
import { CountedRuntime, exitCodeOf, liveRuntime, missingPrerequisites, parseArguments, RunJournal, USAGE } from "../src/index.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-cli-units-"));
after(() => rmSync(workspace, { recursive: true, force: true }));

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
/** Runs the command as a program, and gives its exit code and outputs. */
const oqas = (...args: string[]) =>
  new Promise<{ code: number; out: string; err: string }>((resolve) =>
    execFile(process.execPath, [MAIN, ...args], { cwd: workspace, encoding: "utf8" }, (error, out, err) =>
      resolve({ code: error === null ? 0 : (error.code as number), out, err }),
    ),
  );

describe("the options of the command", () => {
  it("reads the repository, the environment, the forced cartography and the help", () => {
    assert.deepEqual(parseArguments([]), { ok: true, arguments: { force: false, help: false } });
    assert.deepEqual(parseArguments(["--repository", "tests", "--environment", "local", "--force-cartography", "--help"]), {
      ok: true,
      arguments: { repository: "tests", environment: "local", force: true, help: true },
    });
  });

  it("refuses an option without its value, and an unknown option", () => {
    assert.deepEqual(parseArguments(["--repository"]), { ok: false, error: "--repository needs a value." });
    assert.deepEqual(parseArguments(["--environment", "--help"]), { ok: false, error: "--environment needs a value." });
    assert.deepEqual(parseArguments(["--push"]), { ok: false, error: "Unknown option --push; see oqas --help." });
    assert.deepEqual(parseArguments(["--brief", "tester la recherche d'un client"]), {
      ok: true,
      arguments: { brief: "tester la recherche d'un client", force: false, help: false },
    });
    assert.deepEqual(parseArguments(["--brief", "  "]), { ok: false, error: "--brief needs a value." });
  });

  it("are the program's: --help prints the usage, a wrong option and a missing configuration exit with 3", async () => {
    assert.deepEqual(await oqas("--help"), { code: 0, out: USAGE, err: "" });
    const wrong = await oqas("--push");
    assert.deepEqual([wrong.code, wrong.err], [3, "Unknown option --push; see oqas --help.\n"]);
    const missing = await oqas("--repository", workspace);
    assert.equal(missing.code, 3);
    assert.match(missing.err, /oqas\.json cannot be read/);
  });
});

describe("the exit code of a run that went to its end", () => {
  it("is 0 when every test passed, 1 when one failed, 2 otherwise, and 2 without any test", () => {
    assert.deepEqual(
      [exitCodeOf(["passed", "passed"]), exitCodeOf(["passed", "failed", "blocked"]), exitCodeOf(["passed", "not_run"]), exitCodeOf([])],
      [0, 1, 2, 2],
    );
    assert.deepEqual([exitCodeOf(["passed", "indeterminate"]), exitCodeOf(["passed", "blocked"]), exitCodeOf(["skipped"])], [2, 2, 2]);
  });
});

describe("the journal of a run", () => {
  it("masks every secret, in the lines and in the file, and gives the figures of a step", () => {
    const lines: string[] = [];
    const journal = new RunJournal({ write: (line) => lines.push(line), now: () => new Date("2026-11-13T12:00:00.000Z") }, ["", "sk-secret"]);
    journal.adopt([{ at: "2026-11-13T11:59:00.000Z", step: "configuration", event: "info", message: "Read with sk-secret." }]);
    journal.record("cartography", "finished", "Done with sk-secret.", { durationMs: 1234, modelRequests: 5 });
    journal.record("design", "error", "Nothing.");
    const file = join(workspace, "runs", "run.jsonl");
    journal.keepIn(file);
    journal.record("execution", "info", "passed: a test.", { durationMs: 10 });
    assert.deepEqual(lines, [
      "[cartography] finished: Done with [secret]. (1.2 s, 5 model requests)\n",
      "[design] error: Nothing.\n",
      "[execution] passed: a test. (0 s)\n",
    ]);
    const written = readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { message: string });
    assert.deepEqual(
      written.map((entry) => entry.message),
      ["Read with [secret].", "Done with [secret].", "Nothing.", "passed: a test."],
    );
  });
});

describe("the prerequisites of the machine", () => {
  it("count npm as missing when it cannot even be called", async () => {
    const text = JSON.stringify({
      formatVersion: 1,
      applications: [
        {
          id: "shop",
          name: "Shop",
          type: "api",
          authentication: { method: "none" },
          environments: [{ name: "local", apis: [{ name: "b", baseUrl: "http://127.0.0.1:1" }] }],
        },
      ],
      knowledge: [],
      model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:1/v1/", model: "m" },
      autonomy: { level: "autonomous" },
    });
    const config = validateConfig(text, {});
    assert.ok(config.ok);
    const missing = await missingPrerequisites(config.config, workspace, { run: () => Promise.reject(new Error("spawn npm ENOENT")) });
    assert.ok(missing.some((problem) => problem.startsWith("npm cannot be run")));
  });

  it("count a folder inside a repository, or a repository without a commit, as no repository the designer can use", async () => {
    const config = validateConfig(
      JSON.stringify({
        formatVersion: 1,
        applications: [
          {
            id: "shop",
            name: "Shop",
            type: "api",
            authentication: { method: "none" },
            environments: [{ name: "local", apis: [{ name: "b", baseUrl: "http://127.0.0.1:1" }] }],
          },
        ],
        knowledge: [],
        model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:1/v1/", model: "m" },
        autonomy: { level: "autonomous" },
      }),
      {},
    );
    assert.ok(config.ok);
    const root = mkdtempSync(join(workspace, "repo-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
    const npm = { run: () => Promise.resolve({ exitCode: 0, stdout: "11.0.0\n", stderr: "" }) };
    const empty = await missingPrerequisites(config.config, root, npm);
    assert.ok(empty.some((problem) => problem.includes("is not the root of a git repository with a commit")));
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "first"], {
      cwd: root,
    });
    mkdirSync(join(root, "tests"));
    const inside = await missingPrerequisites(config.config, join(root, "tests"), npm);
    assert.ok(inside.some((problem) => problem.includes("is not the root of a git repository with a commit")));
    const top = await missingPrerequisites(config.config, root, npm);
    assert.ok(!top.some((problem) => problem.includes("git repository")));
  });
});

describe("the runtime of the agents on the model of the configuration", () => {
  it("sends the key of the model, read from the environment, and releases its folder", async () => {
    const server = await scriptedServer([{ body: answer("m", "Hello.") }]);
    const text = JSON.stringify({
      formatVersion: 1,
      applications: [
        {
          id: "shop",
          name: "Shop",
          type: "api",
          authentication: { method: "none" },
          environments: [{ name: "local", apis: [{ name: "b", baseUrl: "http://127.0.0.1:1" }] }],
        },
      ],
      knowledge: [],
      model: { mode: "provider-key", provider: "openai", baseUrl: server.baseUrl, model: "m", apiKeyEnv: "MODEL_KEY" },
      autonomy: { level: "autonomous" },
    });
    const config = validateConfig(text, { MODEL_KEY: "sk-test" });
    assert.ok(config.ok);
    const open = await liveRuntime(config.config, { MODEL_KEY: "sk-test" });
    try {
      const session = await open.runtime.openSession({ instructions: "Answer.", tools: [] });
      for await (const event of session.send("Hello?")) void event;
      await session.close();
    } finally {
      await open.close();
      await server.close();
    }
    assert.equal(server.requests[0]!.headers.authorization, "Bearer sk-test");
  });
});

describe("the count of the requests to the model", () => {
  it("keeps the last counters of each session, whatever its end, and adds the sessions up", async () => {
    const counters = (iterations: number) => ({ iterations, actions: 0, elapsedMs: 0 });
    const turns: AgentEvent[][] = [
      [
        { type: "text", text: "Reading." },
        { type: "end", counters: counters(2) },
      ],
      [{ type: "end", counters: counters(5) }],
      [{ type: "stopped", reason: { limit: "iterations", counters: counters(3) } }],
      [{ type: "error", error: new AgentRuntimeError("down"), counters: counters(4) }],
      [{ type: "end" }],
    ];
    let closed = 0;
    const inner: AgentRuntime = {
      openSession: async () => ({
        async *send() {
          yield* turns.shift()!;
        },
        close: async () => void (closed += 1),
      }),
      close: async () => void (closed += 10),
    };
    const runtime = new CountedRuntime(inner);
    const first = await runtime.openSession({ instructions: "", tools: [] });
    for (const message of ["one", "two"]) for await (const event of first.send(message)) void event;
    assert.equal(runtime.modelRequests, 5, "the counters of a session add up over its turns");
    for (let session = 0; session < 3; session += 1) {
      const next = await runtime.openSession({ instructions: "", tools: [] });
      for await (const event of next.send("go")) void event;
      await next.close();
    }
    assert.equal(runtime.modelRequests, 12);
    await first.close();
    await runtime.close();
    assert.equal(closed, 14);
  });
});
