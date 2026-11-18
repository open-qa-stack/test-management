import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";
import {
  AgentRuntimeError,
  entryLine,
  ImageToolResult,
  validateConfig,
  type AgentEvent,
  type AgentRuntime,
  type RunEntry,
  type SessionOptions,
} from "@open-qa-stack/domain";
import { answer, scriptedServer, toolCalls } from "@open-qa-stack/testing";
import { languageRule, type DesignedTest } from "@open-qa-stack/agents";
import { liveRuntime } from "../src/index.ts";
import { exitCodeOf } from "../src/run/exit-code.ts";
import { missingPrerequisites } from "../src/run/prerequisites.ts";
import { RunJournal } from "../src/run/run-journal.ts";
import { runnableTests } from "../src/run/runnable-tests.ts";
import { CountedRuntime } from "../src/runtime/counted-runtime.ts";
import { GuardedRuntime } from "../src/runtime/guarded-runtime.ts";
import { SpokenRuntime } from "../src/runtime/spoken-runtime.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-engine-units-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

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
  it("masks every secret, in the entries it writes and in those it has kept, and gives the figures of a step", () => {
    const written: RunEntry[] = [];
    const kept: RunEntry[] = [];
    const journal = new RunJournal(
      {
        location: () => "nowhere",
        keep: (_run, earlier) => void kept.push(...earlier),
        entry: (entry) => {
          written.push(entry);
          kept.push(entry);
        },
      },
      () => new Date("2026-11-13T12:00:00.000Z"),
      ["", "sk-secret"],
    );
    journal.adopt([{ at: "2026-11-13T11:59:00.000Z", step: "configuration", event: "info", message: "Read with sk-secret." }]);
    journal.record("cartography", "finished", "Done with sk-secret.", { durationMs: 1234, modelRequests: 5 });
    journal.record("design", "error", "Nothing.");
    kept.length = 0;
    journal.keep({ runId: "oqas-1", stateDir: ".oqas" });
    journal.record("execution", "info", "passed: a test.", { durationMs: 10 });
    assert.deepEqual(written.map(entryLine), [
      "[cartography] finished: Done with [secret]. (1.2 s, 5 model requests)",
      "[design] error: Nothing.",
      "[execution] passed: a test. (0 s)",
    ]);
    assert.deepEqual(
      kept.map((entry) => entry.message),
      ["Read with [secret].", "Done with [secret].", "Nothing.", "passed: a test."],
    );
    assert.deepEqual(
      kept.map((entry) => entry.at),
      ["2026-11-13T11:59:00.000Z", ...Array.from({ length: 3 }, () => "2026-11-13T12:00:00.000Z")],
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

describe("the language of the person in a run", () => {
  it("ends the instructions of each session with its rule, keeps the rest of its options, and closes the runtime it wraps", async () => {
    const opened: SessionOptions[] = [];
    let closed = false;
    const inner: AgentRuntime = {
      openSession: async (options) => {
        opened.push(options);
        return { send: async function* () {}, close: async () => undefined };
      },
      close: async () => void (closed = true),
    };
    const runtime = new SpokenRuntime(inner, "fr");
    const limits = { maxIterations: 4, maxDurationMs: null, maxActions: null };
    await runtime.openSession({ instructions: "Plan the tests.", tools: [], limits });
    assert.deepEqual(opened, [{ instructions: `Plan the tests.\n\n${languageRule("fr")}`, tools: [], limits }]);
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
