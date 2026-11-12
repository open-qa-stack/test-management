import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEvent, StopReason, ToolDefinition } from "@open-qa-stack/domain";
import { TaskBudget } from "../src/guardrails/task-budget.ts";
import { turnVerdict } from "../src/guardrails/turn-verdict.ts";
import { CLAIM, ManualClock, SCENARIOS } from "./scenarios.ts";
import { answer, exchange, loadRecording, MODEL, scriptedServer, toolCalls, withRuntime } from "./support.ts";

interface Replay {
  readonly events: AgentEvent[];
  readonly runs: Map<string, number>;
  readonly stop: StopReason;
}

/** Replays the recording of a scenario and returns its events, how often each tool ran, and why it stopped. */
async function replay(file: string): Promise<Replay> {
  const scenario = SCENARIOS[file]!;
  const clock = new ManualClock();
  const runs = new Map<string, number>();
  const events = await withRuntime({ kind: "replay", recording: loadRecording(file) }, MODEL, (runtime) => exchange(runtime, scenario.session(clock, runs), scenario.message), clock);
  const last = events.at(-1);
  assert.equal(last?.type, "stopped", JSON.stringify(events.slice(-3)));
  return { events, runs, stop: (last as Extract<AgentEvent, { type: "stopped" }>).reason };
}

function stoppedEvent(events: AgentEvent[]): Extract<AgentEvent, { type: "stopped" }> {
  return events.at(-1) as Extract<AgentEvent, { type: "stopped" }>;
}

const refusals = (events: AgentEvent[]) => events.filter((e) => e.type === "tool-error" && e.reason === "limit-reached");

describe("criterion 1 — the 201st browser action under a limit of 200 does not run", () => {
  it("runs 200 actions, refuses the 201st and stops on the action limit", async () => {
    const { events, runs, stop } = await replay("limit-actions.json");
    assert.equal(runs.get("click"), 200);
    assert.equal(refusals(events).length, 1);
    assert.equal(stop.limit, "actions");
  });
});

describe("criterion 2 — only browser actions count against the action limit", () => {
  it("stops with as many actions as browser calls that ran", async () => {
    const { runs, stop } = await replay("limit-actions-mixed.json");
    assert.equal(runs.get("click"), 3);
    assert.equal(runs.get("read_index"), 3);
    assert.equal(stop.counters.actions, 3);
    assert.equal(stop.limit, "actions");
  });
});

describe("criterion 3 — a sixth iteration under a limit of 5 does not start", () => {
  it("serves five model calls and stops on the iteration limit", async () => {
    const recording = loadRecording("limit-iterations.json");
    assert.equal(recording.exchanges.length, 5);
    const { runs, stop } = await replay("limit-iterations.json");
    assert.equal(runs.get("read_index"), 5);
    assert.deepEqual([stop.limit, stop.counters.iterations], ["iterations", 5]);
  });
});

describe("criterion 4 — past 10 minutes, the task stops at the next checkpoint", () => {
  it("stops on the duration limit before the next model call", async () => {
    const { runs, stop } = await replay("limit-duration.json");
    assert.equal(runs.get("read_index"), 1);
    assert.equal(stop.limit, "duration");
    assert.equal(stop.counters.iterations, 1);
    assert.ok(stop.counters.elapsedMs > 10 * 60_000);
  });
});

describe("criterion 5 — the limits come from the input: 2 iterations, 1 minute, 3 actions", () => {
  it("refuses the 4th action", async () => {
    const { runs, stop } = await replay("limit-actions-mixed.json");
    assert.deepEqual([runs.get("click"), stop.limit], [3, "actions"]);
  });

  it("does not start the 3rd iteration", async () => {
    const { runs, stop } = await replay("limit-iterations-small.json");
    assert.deepEqual([runs.get("read_index"), stop.limit, stop.counters.iterations], [2, "iterations", 2]);
  });

  it("stops at the first checkpoint after 1 minute", async () => {
    const { stop } = await replay("limit-duration-small.json");
    assert.equal(stop.limit, "duration");
    assert.ok(stop.counters.elapsedMs > 60_000);
  });
});

describe("criterion 6 — a stopped task is never passed, whatever the model says", () => {
  for (const file of ["limit-actions.json", "limit-iterations.json", "limit-duration.json"]) {
    it(`${file}: the harness says indeterminate, after the model claimed success`, async () => {
      const { events } = await replay(file);
      assert.ok(events.some((e) => e.type === "text" && e.text === CLAIM));
      assert.equal(turnVerdict(stoppedEvent(events)), "indeterminate");
    });
  }

  it("a turn that ends normally has run no test", () => {
    assert.equal(turnVerdict({ type: "end" }), "not_run");
  });
});

describe("criterion 7 — the stop reason carries the three counters", () => {
  it("gives iterations, actions and elapsed time at the stop", async () => {
    const { stop } = await replay("limit-actions.json");
    assert.deepEqual(stop.counters, { iterations: 1, actions: 200, elapsedMs: 0 });
  });
});

describe("criterion 8 — the budget on its own, without SDK, network or model", () => {
  it("allows a call that reaches a limit exactly and stops on the one that exceeds it", () => {
    const clock = new ManualClock();
    const budget = new TaskBudget({ maxIterations: 1, maxDurationMs: null, maxActions: 1 }, clock);
    budget.startIteration();
    budget.startToolCall(true);
    assert.equal(budget.stopped, false);
    budget.startToolCall(false);
    assert.equal(budget.stopped, false);
    budget.startToolCall(true);
    assert.deepEqual(budget.stopReason, { limit: "actions", counters: { iterations: 1, actions: 1, elapsedMs: 0 } });
    budget.startIteration();
    assert.equal(budget.stopReason?.limit, "actions");
    assert.deepEqual(budget.stopReason?.counters, { iterations: 1, actions: 1, elapsedMs: 0 });
  });

  it("checks the duration first, and leaves an unbounded limit alone", () => {
    const clock = new ManualClock();
    const budget = new TaskBudget({ maxIterations: null, maxDurationMs: 1000, maxActions: null }, clock);
    for (let i = 0; i < 50; i++) budget.startToolCall(true);
    budget.startIteration();
    assert.equal(budget.stopped, false);
    clock.advance(1001);
    budget.startToolCall(true);
    assert.deepEqual(budget.stopReason, { limit: "duration", counters: { iterations: 1, actions: 50, elapsedMs: 1001 } });
  });
});

describe("budgets of concurrent sessions", () => {
  it("keeps each session's limits on its own channel", async () => {
    const server = await scriptedServer([
      { body: toolCalls(MODEL, [{ id: "a1", name: "open_other", arguments: {} }]) },
      { body: answer(MODEL, "Other session.") },
      { body: answer(MODEL, CLAIM) },
    ]);
    try {
      await withRuntime({ kind: "live", upstream: { baseUrl: server.baseUrl } }, MODEL, async (runtime) => {
        const openOther: ToolDefinition = {
          name: "open_other",
          description: "Opens another session.",
          parameters: { type: "object" },
          execute: async () => {
            await exchange(runtime, { instructions: "x", tools: [] }, "Hello.");
            return "done";
          },
        };
        const events = await exchange(runtime, { instructions: "x", tools: [openOther], limits: { maxIterations: 1, maxDurationMs: null, maxActions: null } }, "Go.");
        assert.deepEqual(stoppedEvent(events).reason, { limit: "iterations", counters: { iterations: 1, actions: 0, elapsedMs: stoppedEvent(events).reason.counters.elapsedMs } });
      });
      assert.equal(server.requests.length, 2);
    } finally {
      await server.close();
    }
  });

  it("reports a call to an unknown tool once, even after the task stopped", async () => {
    const runs = new Map<string, number>();
    const clock = new ManualClock();
    const server = await scriptedServer([{ body: toolCalls(MODEL, [{ id: "c1", name: "click", arguments: {} }, { id: "c2", name: "click", arguments: {} }, { id: "c3", name: "ghost", arguments: {} }]) }]);
    try {
      const events = await withRuntime({ kind: "live", upstream: { baseUrl: server.baseUrl } }, MODEL, (runtime) =>
        exchange(runtime, SCENARIOS["limit-actions-mixed.json"]!.session(clock, runs), "Click.").then((all) => all),
      );
      assert.deepEqual(events.filter((e) => e.type === "tool-error" && e.callId === "c3").map((e) => e.type === "tool-error" && e.reason), ["unknown-tool"]);
    } finally {
      await server.close();
    }
  });
});
