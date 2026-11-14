import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import net from "node:net";
import { describe, it } from "node:test";
import { ModelResponseError, ModelUnreachableError, ReplayMissError, type AgentEvent } from "@open-qa-stack/domain";
import { parseRecording, TOOL_CALLING_CHECK, type Recording } from "../src/index.ts";
import { answer, closedPort, MODEL_SERVER_PORT, NetworkAccessError, scriptedServer } from "@open-qa-stack/testing";
import { SCENARIOS } from "./scenarios.ts";
import { exchange, loadRecording, MODEL, RECORDINGS, withRuntime } from "./support.ts";

const RECORDED = "tool-calling.qwen3-coder-30b.json";

/** Model the recording was made with. */
function modelOf(recording: Recording): string {
  assert.equal(recording.origin.kind, "recorded");
  return recording.origin.model;
}

function errorOf(events: AgentEvent[]): Error {
  const last = events.at(-1);
  assert.equal(last?.type, "error", JSON.stringify(events));
  return (last as Extract<AgentEvent, { type: "error" }>).error;
}

/** Every module specifier a TypeScript source imports, whatever the form of the import. */
function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!);
}

describe("criterion 2 — only the Copilot implementation imports the SDK", () => {
  it("finds the SDK in harness/src/copilot/ only, in every package, tests included", () => {
    const packages = new URL("../../", import.meta.url);
    // Only the folders a package writes by hand: a build output may be rebuilt while this test reads.
    const folders = readdirSync(packages).flatMap((name) => ["src", "scripts", "test"].map((folder) => `${name}/${folder}`));
    const files = folders
      .filter((folder) => existsSync(new URL(folder, packages)))
      .flatMap((folder) => readdirSync(new URL(`${folder}/`, packages), { recursive: true, encoding: "utf8" }).map((f) => `${folder}/${f}`))
      .filter((f) => f.endsWith(".ts"));
    const importers = files.filter((f) => importsOf(readFileSync(new URL(f, packages), "utf8")).includes("@github/copilot-sdk"));
    assert.ok(importers.length > 0);
    assert.deepEqual(
      importers.filter((f) => !f.startsWith("harness/src/copilot/")),
      [],
    );
    assert.deepEqual(importsOf(`import x from 'a'; import "b"; await import("c"); export { y } from "d";`), ["a", "b", "c", "d"]);
  });
});

describe("criterion 3 — a replayed session calls both tools and answers, as recorded", () => {
  it("yields the recorded tool calls in order, their results, then the final answer", async () => {
    const recording = loadRecording(RECORDED);
    const events = await withRuntime({ kind: "replay", recording }, modelOf(recording), (runtime) =>
      exchange(runtime, TOOL_CALLING_CHECK.session(), TOOL_CALLING_CHECK.message),
    );
    type Wire = { choices: { message: { content: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] };
    const [first, second] = recording.exchanges.map((e) => (e.response as Wire).choices[0]!.message);
    const recordedCalls = first!.tool_calls!.map((c) => ({ callId: c.id, tool: c.function.name, arguments: JSON.parse(c.function.arguments) as unknown }));
    const calls = events.flatMap((e) => (e.type === "tool-call" ? [{ callId: e.callId, tool: e.tool, arguments: e.arguments }] : []));
    assert.deepEqual(calls, recordedCalls);
    for (const call of calls) {
      const result = events.findIndex((e) => e.type === "tool-result" && e.callId === call.callId);
      assert.ok(result > events.findIndex((e) => e.type === "tool-call" && e.callId === call.callId), call.tool);
    }
    assert.deepEqual(events.slice(-2), [{ type: "text", text: second!.content }, { type: "end" }]);
    assert.deepEqual(TOOL_CALLING_CHECK.evaluate(events), { calledBothTools: true, argumentsMatchSchemas: true, noOtherTool: true, quotedResults: true });
  });
});

describe("criterion 4 — arguments that do not match the schema never reach the tool", () => {
  it("reports a tool error and does not run the tool", async () => {
    let runs = 0;
    const tools = TOOL_CALLING_CHECK.tools().map((t) => ({ ...t, execute: async (args: unknown) => (runs++, t.execute(args)) }));
    const events = await withRuntime({ kind: "replay", recording: loadRecording("invalid-arguments.json") }, MODEL, (runtime) =>
      exchange(runtime, { instructions: TOOL_CALLING_CHECK.instructions, tools }, TOOL_CALLING_CHECK.message),
    );
    assert.equal(runs, 0);
    const errors = events.filter((e) => e.type === "tool-error");
    assert.deepEqual(
      errors.map((e) => [e.callId, e.tool, e.reason]),
      [["call-1", "convert_price", "invalid-arguments"]],
    );
    assert.match(errors[0]!.message, /arguments\/amount must be number/);
    assert.equal(events.at(-1)?.type, "end");
    assert.equal(TOOL_CALLING_CHECK.evaluate(events).argumentsMatchSchemas, false);
  });
});

describe("criterion 5 — a request missing from the recording is a replay error", () => {
  it("describes the request and never reaches a model", async () => {
    const recording = loadRecording(RECORDED);
    const events = await withRuntime({ kind: "replay", recording }, modelOf(recording), (runtime) =>
      exchange(runtime, TOOL_CALLING_CHECK.session(), "Say hello."),
    );
    const error = errorOf(events);
    assert.ok(error instanceof ReplayMissError);
    assert.match(error.message, /request 1 of the session \(2 messages, last message from user: "Say hello\."\)/);
  });
});

describe("criterion 6 — an unreachable model is a typed error naming the address", () => {
  it("names the address and not the key", async () => {
    const baseUrl = `http://127.0.0.1:${await closedPort()}/v1`;
    const apiKey = "sk-test-value-that-must-not-leak";
    const events = await withRuntime({ kind: "live", upstream: { baseUrl, apiKey } }, MODEL, (runtime) =>
      exchange(runtime, TOOL_CALLING_CHECK.session(), TOOL_CALLING_CHECK.message),
    );
    const error = errorOf(events);
    assert.ok(error instanceof ModelUnreachableError);
    assert.equal(error.url, baseUrl);
    assert.ok(error.message.includes(baseUrl));
    assert.ok(!JSON.stringify(events).includes(apiKey) && !error.message.includes(apiKey));
  });
});

describe("criterion 7 — the tests run without a local model server", () => {
  it("cannot reach the port of a local model server, nor any remote host", () => {
    assert.throws(() => net.connect({ host: "127.0.0.1", port: MODEL_SERVER_PORT }), NetworkAccessError);
    assert.throws(() => net.connect(MODEL_SERVER_PORT, "localhost"), NetworkAccessError);
    assert.throws(() => net.connect({ host: "192.0.2.1", port: 80 }), NetworkAccessError);
  });
});

describe("criteria 8 and 9 — every recording declares its origin and holds no secret", () => {
  const files = readdirSync(RECORDINGS)
    .filter((f) => f.endsWith(".json"))
    .sort();

  it("parses every recording and checks its origin", () => {
    assert.deepEqual(files, [RECORDED, ...Object.keys(SCENARIOS)].sort());
    for (const file of files) {
      const { origin } = parseRecording(readFileSync(new URL(file, RECORDINGS), "utf8"));
      if (origin.kind === "recorded") {
        assert.ok(origin.model !== "" && /LM Studio \d/.test(origin.server), file);
      } else {
        assert.ok(origin.purpose !== "", file);
      }
    }
  });

  it("contains no key, no authorization, no absolute path of a machine", () => {
    for (const file of files) {
      const content = readFileSync(new URL(file, RECORDINGS), "utf8");
      assert.doesNotMatch(content, /sk-|Bearer|authorization|\/Users\/|\/home\/|[A-Z]:\\\\/i, file);
    }
  });
});

describe("invented tools", () => {
  it("reports a call to a tool the session does not offer, and the check sees it", async () => {
    const events = await withRuntime({ kind: "replay", recording: loadRecording("unknown-tool.json") }, MODEL, (runtime) =>
      exchange(runtime, TOOL_CALLING_CHECK.session(), TOOL_CALLING_CHECK.message),
    );
    assert.deepEqual(events.slice(0, 2), [
      { type: "tool-call", callId: "call-1", tool: "delete_everything", arguments: {} },
      {
        type: "tool-error",
        callId: "call-1",
        tool: "delete_everything",
        reason: "unknown-tool",
        message: "The session offers no tool named delete_everything.",
      },
    ]);
    assert.equal(TOOL_CALLING_CHECK.evaluate(events).noOtherTool, false);
  });
});

describe("record mode", () => {
  it("sends the key to the model server only, and records the exchanges without it", async () => {
    const server = await scriptedServer([{ body: answer(MODEL, "Hello.") }]);
    try {
      const recording = await withRuntime(
        {
          kind: "record",
          upstream: { baseUrl: server.baseUrl, apiKey: "sk-record-test", reasoningEffort: "none" },
          origin: { kind: "recorded", model: MODEL, server: "scripted", recordedOn: "2026-01-01" },
        },
        MODEL,
        async (runtime, gateway) => {
          const events = await exchange(runtime, TOOL_CALLING_CHECK.session(), "Say hello.");
          assert.deepEqual(events, [{ type: "text", text: "Hello." }, { type: "end" }]);
          return gateway.recording;
        },
      );
      assert.equal(server.requests[0]!.headers.authorization, "Bearer sk-record-test");
      assert.equal((server.requests[0]!.body as { reasoning_effort?: unknown }).reasoning_effort, "none");
      assert.equal(recording.exchanges.length, 1);
      assert.ok(!JSON.stringify(recording).includes("sk-record-test"));
    } finally {
      await server.close();
    }
  });
});

describe("live mode", () => {
  it("reports an error status, then answers the next message of the same session", async () => {
    const server = await scriptedServer([{ status: 503, body: { error: { message: "busy" } } }, { body: answer(MODEL, "Back.") }]);
    try {
      await withRuntime({ kind: "live", upstream: { baseUrl: server.baseUrl } }, MODEL, async (runtime) => {
        const session = await runtime.openSession(TOOL_CALLING_CHECK.session());
        const first: AgentEvent[] = [];
        for await (const event of session.send("Say hello.")) first.push(event);
        const error = errorOf(first);
        assert.ok(error instanceof ModelResponseError);
        assert.equal(error.message, "The model answered with status 503: busy");
        const second: AgentEvent[] = [];
        for await (const event of session.send("Again.")) second.push(event);
        assert.deepEqual(second, [{ type: "text", text: "Back." }, { type: "end" }]);
      });
      assert.equal(server.requests[0]!.headers.authorization, undefined);
      assert.notEqual((server.requests[0]!.body as { reasoning_effort?: unknown }).reasoning_effort, "none");
    } finally {
      await server.close();
    }
  });

  it("reports a model server that answers with something other than JSON", async () => {
    const server = await scriptedServer([{ body: "<html>proxy</html>", raw: true }]);
    try {
      const events = await withRuntime({ kind: "live", upstream: { baseUrl: server.baseUrl } }, MODEL, (runtime) =>
        exchange(runtime, TOOL_CALLING_CHECK.session(), "Say hello."),
      );
      assert.equal(errorOf(events).message, "The model answered with a body that is not JSON.");
    } finally {
      await server.close();
    }
  });

  it("ends the turn with an error when the session closes during it", async () => {
    const server = await scriptedServer([
      {
        body: {
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: { role: "assistant", content: "", tool_calls: [{ type: "function", id: "c1", function: { name: "get_inventory", arguments: "{}" } }] },
            },
          ],
        },
      },
    ]);
    try {
      await withRuntime({ kind: "live", upstream: { baseUrl: server.baseUrl } }, MODEL, async (runtime) => {
        let close: () => Promise<void> = async () => {};
        const tools = TOOL_CALLING_CHECK.tools().map((t) => ({ ...t, execute: async () => (await close(), t.execute({})) }));
        const session = await runtime.openSession({ instructions: "x", tools });
        close = () => session.close();
        const events: AgentEvent[] = [];
        for await (const event of session.send("Check the stock.")) events.push(event);
        assert.equal(errorOf(events).name, "SessionClosedError");
      });
    } finally {
      await server.close();
    }
  });

  it("reports a tool that fails, and keeps one runtime for several sessions", async () => {
    const server = await scriptedServer([
      {
        body: {
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: { role: "assistant", content: "", tool_calls: [{ type: "function", id: "c1", function: { name: "get_inventory", arguments: "{}" } }] },
            },
          ],
        },
      },
      { body: answer(MODEL, "The inventory is unavailable.") },
      { body: answer(MODEL, "Second session.") },
    ]);
    try {
      await withRuntime({ kind: "live", upstream: { baseUrl: server.baseUrl } }, MODEL, async (runtime) => {
        const failing = TOOL_CALLING_CHECK.tools().map((t) => ({ ...t, execute: async () => Promise.reject(new Error("stock service down")) }));
        const first = await exchange(runtime, { instructions: "x", tools: failing }, "Check the stock.");
        assert.deepEqual(
          first.filter((e) => e.type === "tool-error").map((e) => [e.reason, e.message]),
          [["failed", "stock service down"]],
        );
        const second = await exchange(runtime, { instructions: "x", tools: [] }, "Again.");
        assert.deepEqual(second, [{ type: "text", text: "Second session." }, { type: "end" }]);
      });
    } finally {
      await server.close();
    }
  });

  it("closes the sessions still open when the runtime closes", async () => {
    const server = await scriptedServer([]);
    try {
      await withRuntime({ kind: "live", upstream: { baseUrl: server.baseUrl } }, MODEL, async (runtime) => {
        await runtime.openSession({ instructions: "x", tools: [] });
      });
    } finally {
      await server.close();
    }
  });
});

describe("the reasoning of the model", () => {
  it("is relayed before the text, when the model gives it", async () => {
    const reply = answer(MODEL, "Hello.") as { choices: { message: Record<string, unknown> }[] };
    reply.choices[0]!.message.reasoning_content = "The user wants a greeting.";
    const server = await scriptedServer([{ body: reply }]);
    try {
      const events = await withRuntime({ kind: "live", upstream: { baseUrl: server.baseUrl } }, MODEL, (runtime) =>
        exchange(runtime, TOOL_CALLING_CHECK.session(), "Say hello."),
      );
      assert.deepEqual(events, [{ type: "reasoning", text: "The user wants a greeting." }, { type: "text", text: "Hello." }, { type: "end" }]);
    } finally {
      await server.close();
    }
  });

  it("is left out when it is only blank", async () => {
    const reply = answer(MODEL, "Hello.") as { choices: { message: Record<string, unknown> }[] };
    reply.choices[0]!.message.reasoning_content = "  ";
    const server = await scriptedServer([{ body: reply }]);
    try {
      const events = await withRuntime({ kind: "live", upstream: { baseUrl: server.baseUrl } }, MODEL, (runtime) =>
        exchange(runtime, TOOL_CALLING_CHECK.session(), "Say hello."),
      );
      assert.deepEqual(events, [{ type: "text", text: "Hello." }, { type: "end" }]);
    } finally {
      await server.close();
    }
  });
});
