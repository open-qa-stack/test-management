import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@open-qa-stack/shared";
import { answer, scriptedServer, toolCalls } from "@open-qa-stack/testing";
import { AgentRuntimeError, ImageToolResult, type AgentEvent, type AgentRuntime, type SessionOptions } from "@open-qa-stack/domain";
import type { DesignedTest, TraceLine } from "@open-qa-stack/agents";
import { followedLine, MAX_FOLLOWED_LENGTH } from "../src/solo/followed-line.ts";
import { runnableTests } from "../src/solo/runnable-tests.ts";
import { CountedRuntime, exitCodeOf, GuardedRuntime, liveRuntime, missingPrerequisites, parseArguments, RunJournal, soloCommand, USAGE } from "../src/index.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-cli-units-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

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
    assert.deepEqual(parseArguments([]), { ok: true, arguments: { force: false, follow: false, help: false, init: false } });
    assert.deepEqual(parseArguments(["--repository", "tests", "--environment", "local", "--force-cartography", "--follow", "--help"]), {
      ok: true,
      arguments: { repository: "tests", environment: "local", force: true, follow: true, help: true, init: false },
    });
  });

  it("refuses an option without its value, and an unknown option", () => {
    assert.deepEqual(parseArguments(["--repository"]), { ok: false, error: "--repository needs a value." });
    assert.deepEqual(parseArguments(["--environment", "--help"]), { ok: false, error: "--environment needs a value." });
    assert.deepEqual(parseArguments(["--push"]), { ok: false, error: "Unknown option --push; see oqas --help." });
    assert.deepEqual(parseArguments(["--brief", "tester la recherche d'un client"]), {
      ok: true,
      arguments: { brief: "tester la recherche d'un client", force: false, follow: false, help: false, init: false },
    });
    assert.deepEqual(parseArguments(["--brief", "  "]), { ok: false, error: "--brief needs a value." });
  });

  it("reads the run to resume, and refuses another identifier, or an option the run resumed keeps", () => {
    assert.deepEqual(parseArguments(["--resume", "oqas-2026-11-13T12-00-00-000Z"]), {
      ok: true,
      arguments: { resume: "oqas-2026-11-13T12-00-00-000Z", force: false, follow: false, help: false, init: false },
    });
    assert.deepEqual(parseArguments(["--resume", "../oqas"]), {
      ok: false,
      error: "--resume needs the identifier of a run, such as oqas-2026-11-13T12-00-00-000Z.",
    });
    const kept = "--resume keeps the environment and the brief of the run, and the cards it made: it takes no --environment, --brief nor --force-cartography.";
    for (const option of [["--environment", "local"], ["--brief", "Orders."], ["--force-cartography"]])
      assert.deepEqual(parseArguments(["--resume", "oqas-1", ...option]), { ok: false, error: kept });
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

describe("the command, called in the process", () => {
  /** Runs the command with outputs that are kept, and gives its exit code and what it wrote. */
  const called = async (argv: string[], write?: (text: string) => void) => {
    let out = "";
    let err = "";
    const code = await soloCommand(argv, {
      env: {},
      cwd: workspace,
      stdout: { write: (text) => (out += text) },
      stderr: {
        write: (text) => {
          write?.(text);
          err += text;
        },
      },
    });
    return { code, out, err };
  };

  it("prints the usage, refuses a wrong option, and stops on a missing configuration with the runner of the machine", async () => {
    assert.deepEqual(await called(["--help"]), { code: 0, out: USAGE, err: "" });
    assert.deepEqual(await called(["--push"]), { code: 3, out: "", err: "Unknown option --push; see oqas --help.\n" });
    const missing = await called([]);
    assert.equal(missing.code, 3);
    assert.match(missing.err, /oqas\.json cannot be read/);
  });

  it("exits with 5 on what is thrown, even when it is no error", async () => {
    let thrown = false;
    const stopped = await called([], () => {
      if (thrown) return;
      thrown = true;
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- what a foreign output may throw
      throw "the output is closed";
    });
    assert.equal(stopped.code, 5);
    assert.match(stopped.err, /oqas stopped on an unexpected error: the output is closed/);
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
      model: { mode: "provider-key", provider: "openai", baseUrl: server.baseUrl, model: "m", apiKeyEnv: "MODEL_KEY", reasoningEffort: "none" },
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
    assert.equal((server.requests[0]!.body as { reasoning_effort?: unknown }).reasoning_effort, "none");
  });
});

describe("the wait the configuration gives for an answer of the model", () => {
  it("bounds each request: a model that never answers in time is reported after two requests", async () => {
    const late = { body: answer("m", "Late."), delayMs: 1500 };
    const server = await scriptedServer([late, late]);
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
      model: { mode: "provider-key", provider: "openai", baseUrl: server.baseUrl, model: "m", requestTimeoutSeconds: 1 },
    });
    const config = validateConfig(text, {});
    assert.ok(config.ok, JSON.stringify(config));
    const open = await liveRuntime(config.config, {});
    const events: AgentEvent[] = [];
    try {
      const session = await open.runtime.openSession({ instructions: "Answer.", tools: [] });
      for await (const event of session.send("Hello?")) events.push(event);
      await session.close();
    } finally {
      await open.close();
      await server.close();
    }
    const last = events.at(-1);
    assert.equal(last?.type === "error" && last.error.message, "The model gave no answer within 1 seconds, 2 times in a row.");
    assert.equal(server.requests.length, 2);
  });
});

describe("a model that reads images", () => {
  /** A PNG image of one pixel. */
  const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

  /** The parts of the messages the model server received in its second request, after the tool ran. */
  async function partsSent(capabilities: readonly string[]): Promise<unknown[]> {
    const server = await scriptedServer([{ body: toolCalls("m", [{ id: "s1", name: "look", arguments: {} }]) }, { body: answer("m", "A pixel.") }]);
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
      model: { mode: "provider-key", provider: "openai", baseUrl: server.baseUrl, model: "m", capabilities },
    });
    try {
      const config = validateConfig(text, {});
      assert.ok(config.ok, JSON.stringify(config));
      const open = await liveRuntime(config.config, {});
      const look = { name: "look", description: "Looks.", parameters: { type: "object" }, execute: async () => new ImageToolResult({ path: "a.png" }, PIXEL) };
      try {
        const session = await open.runtime.openSession({ instructions: "Look.", tools: [look] });
        for await (const event of session.send("Look.")) void event;
        await session.close();
      } finally {
        await open.close();
      }
    } finally {
      await server.close();
    }
    const messages = (server.requests[1]!.body as { messages: { content: unknown }[] }).messages;
    return messages.flatMap((message) => (Array.isArray(message.content) ? (message.content as unknown[]) : []));
  }

  it("is shown the images of the tools when the configuration declares it, and none otherwise", async () => {
    assert.equal(
      (await partsSent(["vision"])).some((part) => (part as { type: string }).type === "image_url"),
      true,
    );
    assert.deepEqual(await partsSent([]), []);
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

describe("the guardrail of a run", () => {
  it("gives each session the shorter of its duration limit and the time left, and nothing below zero", async () => {
    const opened: SessionOptions[] = [];
    let closed = false;
    const inner: AgentRuntime = {
      openSession: async (options) => {
        opened.push(options);
        return { send: async function* () {}, close: async () => undefined };
      },
      close: async () => void (closed = true),
    };
    let clock = 1_000;
    const runtime = new GuardedRuntime(inner, 61_000, () => clock);
    await runtime.openSession({ instructions: "", tools: [] });
    await runtime.openSession({ instructions: "", tools: [], limits: { maxIterations: 4, maxDurationMs: 30_000, maxActions: null } });
    clock = 50_000;
    await runtime.openSession({ instructions: "", tools: [], limits: { maxIterations: null, maxDurationMs: 30_000, maxActions: 9 } });
    clock = 70_000;
    await runtime.openSession({ instructions: "", tools: [], limits: { maxIterations: null, maxDurationMs: null, maxActions: null } });
    assert.deepEqual(
      opened.map((options) => options.limits),
      [
        { maxIterations: null, maxDurationMs: 60_000, maxActions: null },
        { maxIterations: 4, maxDurationMs: 30_000, maxActions: null },
        { maxIterations: null, maxDurationMs: 11_000, maxActions: 9 },
        { maxIterations: null, maxDurationMs: 0, maxActions: null },
      ],
    );
    await runtime.close();
    assert.equal(closed, true);
  });
});

describe("the designed tests the execution runs", () => {
  /** A designed test that stands as its classes say. */
  function designed(path: string, ...classes: readonly ("passed" | "unfinished" | "failing-application" | "duplicate")[]): DesignedTest {
    const classing = classes.map((name) => ({
      at: "2026-01-01T00:00:00.000Z",
      class: name,
      origin: { by: "harness" as const, check: "run_test" },
      reason: "r",
    }));
    return { path, scenario: path, verdict: "passed", classes: classing, runs: [] };
  }

  it("leaves out a test whose last class is unfinished or duplicate, and runs the others in order", () => {
    const tests = [
      designed("a.spec.ts", "passed"),
      designed("b.spec.ts", "unfinished"),
      designed("c.spec.ts", "unfinished", "failing-application"),
      designed("d.spec.ts", "duplicate"),
    ];
    assert.deepEqual(runnableTests(tests), { run: ["a.spec.ts", "c.spec.ts"], leftOut: ["b.spec.ts", "d.spec.ts"] });
    assert.deepEqual(runnableTests([]), { run: [], leftOut: [] });
  });
});

describe("a line of the trace, as a person follows it", () => {
  const at = "2026-11-13T12:34:56.000Z";
  const agent = (event: Extract<TraceLine, { actor: "agent" }>["event"], source?: string): TraceLine => ({
    at,
    phase: "plan",
    actor: "agent",
    event,
    ...(source === undefined ? {} : { source }),
  });
  const harness = (event: Extract<TraceLine, { actor: "harness" }>["event"]): TraceLine => ({ at, phase: "write", actor: "harness", event });

  it("says when, in which phase and for which source, then what the agent did", () => {
    assert.equal(
      followedLine(agent({ type: "tool-call", callId: "1", tool: "shop_click", arguments: { target: { role: "button", name: "Search" } } }, "shop")),
      '12:34:56 plan shop -> shop_click({"target":{"role":"button","name":"Search"}})',
    );
    assert.equal(followedLine(agent({ type: "tool-result", callId: "1", tool: "shop_click", result: "One\n  order." })), "12:34:56 plan <- One order.");
    assert.equal(followedLine(agent({ type: "tool-result", callId: "1", tool: "shop_click", result: undefined })), "12:34:56 plan <- undefined");
    assert.equal(
      followedLine(agent({ type: "tool-error", callId: "1", tool: "shop_click", reason: "failed", message: "No such button." })),
      "12:34:56 plan !! shop_click (failed): No such button.",
    );
    assert.equal(followedLine(agent({ type: "text", text: "Done." })), "12:34:56 plan agent: Done.");
    assert.equal(followedLine(agent({ type: "reasoning", text: "I look first." })), "12:34:56 plan agent thinks: I look first.");
    assert.equal(
      followedLine(agent({ type: "error", error: { name: "ModelResponseError", message: "The model answered with status 500." } })),
      "12:34:56 plan !! ModelResponseError: The model answered with status 500.",
    );
    assert.equal(
      followedLine(agent({ type: "stopped", reason: { limit: "duration", counters: { iterations: 1, actions: 0, elapsedMs: 1 } } })),
      "12:34:56 plan stopped by its duration limit",
    );
  });

  it("says what the harness told the agent, and what a phase asked of the model", () => {
    assert.equal(followedLine(harness({ type: "message", text: "Write the test." })), "12:34:56 write harness: Write the test.");
    assert.equal(followedLine(harness({ type: "usage", requests: 3 })), "12:34:56 write 3 model requests");
    assert.equal(followedLine(harness({ type: "usage", requests: 3, inputTokens: 1200 })), "12:34:56 write 3 model requests");
    assert.equal(
      followedLine(harness({ type: "usage", requests: 3, inputTokens: 1200, outputTokens: 40 })),
      "12:34:56 write 3 model requests, 1200 tokens read, 0 of them from the cache, 40 written",
    );
    assert.equal(
      followedLine(harness({ type: "usage", requests: 3, inputTokens: 1200, outputTokens: 40, cachedTokens: 1000 })),
      "12:34:56 write 3 model requests, 1200 tokens read, 1000 of them from the cache, 40 written",
    );
  });

  it("cuts a long text, and leaves out what the journal prints or what says nothing to follow", () => {
    assert.equal(followedLine(agent({ type: "text", text: "x".repeat(MAX_FOLLOWED_LENGTH + 5) })), `12:34:56 plan agent: ${"x".repeat(MAX_FOLLOWED_LENGTH)}…`);
    assert.equal(followedLine(harness({ type: "journal", level: "info", message: "The plan was accepted." })), undefined);
    assert.equal(followedLine(harness({ type: "started" })), undefined);
    assert.equal(followedLine(agent({ type: "end" })), undefined);
  });
});
