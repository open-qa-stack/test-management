import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { ModelResponseError, ModelUnreachableError, ReplayMissError, type AgentEvent } from "@open-qa-stack/domain";
import { answer, scriptedServer, toolCalls } from "@open-qa-stack/testing";
import { runtimeEnvironment } from "../src/copilot/runtime-environment.ts";
import { runtimeError } from "../src/copilot/runtime-error.ts";
import { canonicalRequest, describeRequest } from "../src/model-gateway/canonical-request.ts";
import { SYSTEM_CLOCK } from "../src/guardrails/clock.ts";
import { SessionImages } from "../src/tools/session-images.ts";
import {
  CopilotAgentRuntime,
  guardTool,
  ModelGateway,
  parseRecording,
  recordToolCallingCheck,
  RecordingFormatError,
  TOOL_CALLING_CHECK,
} from "../src/index.ts";
import { MAX_REASON_LENGTH, upstreamReason } from "../src/model-gateway/upstream-reason.ts";
import { MODEL } from "./support.ts";

describe("the reason of an error answer of the upstream server", () => {
  it("reads the message of the error, on one line", () => {
    assert.equal(upstreamReason(JSON.stringify({ error: { message: "Unsupported\n  parameter: 'x'." } }), undefined), "Unsupported parameter: 'x'.");
    assert.equal(upstreamReason(JSON.stringify({ error: "Model not loaded." }), ""), "Model not loaded.");
  });

  it("never gives the key sent to the server", () => {
    assert.equal(upstreamReason(JSON.stringify({ error: { message: "Bad key sk-secret given." } }), "sk-secret"), "Bad key [masked] given.");
  });

  it("cuts a long reason", () => {
    const reason = upstreamReason(JSON.stringify({ error: { message: "x".repeat(MAX_REASON_LENGTH + 10) } }), undefined);
    assert.equal(reason, `${"x".repeat(MAX_REASON_LENGTH)}…`);
  });

  it("gives nothing when the body says nothing", () => {
    for (const body of ["not json", "null", "{}", JSON.stringify({ error: { code: 1 } }), JSON.stringify({ error: { message: "  " } })])
      assert.equal(upstreamReason(body, undefined), undefined, body);
  });
});

describe("runtime errors from gateway failures", () => {
  it("maps each failure to its error", () => {
    assert.ok(runtimeError({ kind: "unreachable", url: "http://x/v1" }) instanceof ModelUnreachableError);
    assert.ok(runtimeError({ kind: "replay-miss", request: "r" }) instanceof ReplayMissError);
    assert.equal(runtimeError({ kind: "upstream-status", status: 500 }).message, "The model answered with status 500.");
    assert.equal(
      runtimeError({ kind: "upstream-status", status: 400, reason: "Unsupported parameter." }).message,
      "The model answered with status 400: Unsupported parameter.",
    );
    assert.equal(runtimeError({ kind: "timed-out", seconds: 300, attempts: 2 }).message, "The model gave no answer within 300 seconds, 2 times in a row.");
    assert.equal(runtimeError({ kind: "invalid-response" }).message, "The model answered with a body that is not JSON.");
    assert.equal(runtimeError({ kind: "invalid-request" }).message, "The model runtime sent a request the gateway could not read.");
    assert.equal(runtimeError({ kind: "task-stopped" }).message, "The task was stopped by a limit before the model call.");
    assert.equal(
      runtimeError({ kind: "unsupported", path: "GET /v1/models" }).message,
      "The model runtime sent a request the gateway does not support: GET /v1/models.",
    );
    assert.equal(runtimeError(undefined).message, "The model call failed.");
    assert.ok(runtimeError(undefined) instanceof ModelResponseError);
  });
});

describe("environment of the Copilot runtime", () => {
  it("passes only the variables the runtime needs, never a key", () => {
    const env = runtimeEnvironment({ PATH: "/bin", HOME: "/h", OQAS_MODEL_API_KEY: "sk-secret", AWS_SECRET_ACCESS_KEY: "x" });
    assert.deepEqual(env, { PATH: "/bin", HOME: "/h", COPILOT_TELEMETRY_DISABLED: "true" });
  });
});

describe("model gateway", () => {
  const empty = { formatVersion: 1, origin: { kind: "handwritten", purpose: "x" }, exchanges: [] } as const;

  it("refuses anything but readable chat completions, and forgets a failure on the next request", async () => {
    const gateway = await ModelGateway.start({ kind: "replay", recording: empty });
    try {
      const channel = gateway.createChannel(undefined);
      assert.equal((await fetch(`${channel.baseUrl}/models`)).status, 400);
      assert.deepEqual(channel.lastFailure, { kind: "unsupported", path: "GET /models" });
      assert.equal((await fetch(`${channel.baseUrl}/chat/completions`, { method: "POST", body: "not json" })).status, 400);
      assert.deepEqual(channel.lastFailure, { kind: "invalid-request" });
      assert.equal((await fetch(`${channel.baseUrl}/chat/completions`, { method: "POST", body: "{}" })).status, 400);
      assert.deepEqual(channel.lastFailure, { kind: "invalid-request" });
      await fetch(`${channel.baseUrl}/chat/completions`, { method: "POST", body: JSON.stringify({ model: "m", messages: [] }) });
      assert.equal(channel.lastFailure?.kind, "replay-miss");
      assert.throws(() => gateway.recording, /record mode/);
    } finally {
      await gateway.close();
    }
  });

  it("answers 404 to an unknown channel and keeps the failures of each channel apart", async () => {
    const gateway = await ModelGateway.start({ kind: "replay", recording: empty });
    try {
      const origin = new URL(gateway.createChannel(undefined).baseUrl).origin;
      assert.equal((await fetch(`${origin}/c/99/v1/chat/completions`, { method: "POST", body: "{}" })).status, 404);
      assert.equal((await fetch(`${origin}/v1/chat/completions`, { method: "POST", body: "{}" })).status, 404);
      const stopped = gateway.createChannel({ startIteration: () => {}, stopped: true });
      const open = gateway.createChannel(undefined);
      await fetch(`${stopped.baseUrl}/chat/completions`, { method: "POST", body: JSON.stringify({ model: "m", messages: [] }) });
      assert.deepEqual(stopped.lastFailure, { kind: "task-stopped" });
      assert.equal(open.lastFailure, undefined);
    } finally {
      await gateway.close();
    }
  });
});

describe("recordings", () => {
  it("refuses a file that is not JSON or not a recording", () => {
    assert.throws(() => parseRecording("{"), new RecordingFormatError("The recording is not valid JSON."));
    assert.throws(() => parseRecording("{}"), /format version 1: \/ is invalid/);
    assert.throws(() => parseRecording('{"formatVersion":1,"origin":{"kind":"recorded"},"exchanges":[]}'), /\/origin is invalid/);
  });

  it("reduces a request to what identifies it", () => {
    const request = canonicalRequest({
      model: "m",
      messages: [
        { role: "user", content: "<current_datetime>2026-11-12T21:33:29+01:00</current_datetime>\n\nHi" },
        { role: "assistant", content: null, tool_calls: [{ id: "1", function: { name: "t", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "1", content: "ok" },
      ],
    });
    assert.deepEqual(request, {
      model: "m",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: null, toolCalls: [{ id: "1", name: "t", arguments: "{}" }] },
        { role: "tool", content: "ok", toolCallId: "1" },
      ],
      tools: [],
    });
  });

  it("describes a request by its last message", () => {
    assert.equal(describeRequest({ model: "m", messages: [], tools: [] }, 1), "request 1 of the session (0 messages, no message)");
    assert.equal(
      describeRequest({ model: "m", messages: [{ role: "assistant", content: null }], tools: [] }, 2),
      'request 2 of the session (1 messages, last message from assistant: "")',
    );
  });
});

describe("guarded tools", () => {
  it("reports a tool that throws something other than an error", async () => {
    const events: AgentEvent[] = [];
    const run = guardTool(
      { name: "t", description: "d", parameters: { type: "object" }, execute: () => Promise.reject("plain text") },
      (e) => events.push(e),
      new SessionImages(false),
    );
    assert.deepEqual(await run({}, "c"), { error: "plain text" });
    assert.deepEqual(events, [{ type: "tool-error", callId: "c", tool: "t", reason: "failed", message: "plain text" }]);
  });
});

describe("tool-calling check", () => {
  const call = (tool: string): AgentEvent => ({ type: "tool-call", callId: tool, tool, arguments: {} });
  const text = (value: string): AgentEvent => ({ type: "text", text: value });

  it("passes a session that meets the four points", () => {
    const verdict = TOOL_CALLING_CHECK.evaluate([call("get_inventory"), call("convert_price"), text("7 items, 130.80 EUR.")]);
    assert.deepEqual(verdict, { calledBothTools: true, argumentsMatchSchemas: true, noOtherTool: true, quotedResults: true });
  });

  it("fails each point on its own", () => {
    assert.equal(TOOL_CALLING_CHECK.evaluate([call("get_inventory"), text("7 and 130.80")]).calledBothTools, false);
    const refused: AgentEvent = { type: "tool-error", callId: "c", tool: "convert_price", reason: "invalid-arguments", message: "m" };
    assert.equal(TOOL_CALLING_CHECK.evaluate([refused]).argumentsMatchSchemas, false);
    assert.equal(TOOL_CALLING_CHECK.evaluate([call("delete_everything")]).noOtherTool, false);
    assert.equal(TOOL_CALLING_CHECK.evaluate([text("Done: 130.80 EUR.")]).quotedResults, false);
    assert.equal(TOOL_CALLING_CHECK.evaluate([text("17 items, 130.80 EUR.")]).quotedResults, false);
  });

  it("records a check against a model server, with its verdict", async () => {
    const server = await scriptedServer([
      {
        body: toolCalls(MODEL, [
          { id: "a", name: "get_inventory", arguments: {} },
          { id: "b", name: "convert_price", arguments: { amount: 120, currency: "EUR" } },
        ]),
      },
      { body: answer(MODEL, "7 items; 130.80 EUR.") },
    ]);
    const homeDirectory = mkdtempSync(join(tmpdir(), "oqas-copilot-test-"));
    try {
      const result = await recordToolCallingCheck({
        upstream: { baseUrl: server.baseUrl },
        model: MODEL,
        server: "scripted",
        recordedOn: "2026-01-01",
        homeDirectory,
      });
      assert.deepEqual(result.verdict, { calledBothTools: true, argumentsMatchSchemas: true, noOtherTool: true, quotedResults: true });
      assert.equal(result.recording.exchanges.length, 2);
      assert.deepEqual(result.recording.origin, { kind: "recorded", model: MODEL, server: "scripted", recordedOn: "2026-01-01" });
    } finally {
      rmSync(homeDirectory, { recursive: true, force: true });
      await server.close();
    }
  });
});

describe("pre-tool hook", () => {
  it("refuses a call without identifier once the task is stopped, without recording it", async () => {
    const { preToolUse } = await import("../src/copilot/pre-tool-use.ts");
    const { TaskBudget } = await import("../src/guardrails/task-budget.ts");
    const budget = new TaskBudget({ maxIterations: null, maxDurationMs: null, maxActions: 0 }, SYSTEM_CLOCK);
    const refused = new Map();
    const input = { sessionId: "s", timestamp: new Date(0), cwd: "/", workingDirectory: "/", toolName: "click", toolArgs: {} };
    assert.equal(preToolUse(input, { budget, browserTools: new Set(["click"]), refused }).permissionDecision, "deny");
    assert.equal(refused.size, 0);
  });
});

describe("system clock", () => {
  it("tells a time that never goes back", () => {
    const before = performance.now();
    const now = SYSTEM_CLOCK.now();
    assert.ok(now >= before && now <= performance.now());
  });
});

describe("Copilot runtime", () => {
  it("closes without having started", async () => {
    const home = mkdtempSync(join(tmpdir(), "oqas-copilot-test-"));
    try {
      const runtime = new CopilotAgentRuntime({
        endpoint: { createChannel: () => ({ baseUrl: "http://127.0.0.1:9/v1", lastFailure: undefined }) },
        model: "m",
        homeDirectory: home,
      });
      await runtime.close();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
