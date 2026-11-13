import type { SessionOptions, TaskLimits, ToolDefinition } from "@open-qa-stack/domain";
import { answer, toolCalls } from "@open-qa-stack/testing";
import { TOOL_CALLING_CHECK, type Clock } from "../src/index.ts";
import { MODEL } from "./support.ts";

/** A clock the tests move by hand. */
export class ManualClock implements Clock {
  private time = 0;

  /** @returns The current time, in milliseconds. */
  public now(): number {
    return this.time;
  }

  /** @param ms - How far to move the clock forward. */
  public advance(ms: number): void {
    this.time += ms;
  }
}

/** A scripted session: what the model answers, and what the session offers. Its recording is in `RECORDINGS`. */
export interface Scenario {
  readonly purpose: string;
  readonly replies: readonly unknown[];
  readonly message: string;
  /** @returns The options of the session, with tools bound to `clock` and counting runs in `runs`. */
  session(clock: ManualClock, runs: Map<string, number>): SessionOptions;
}

/** What a careless model says, served before the task stops. */
export const CLAIM = "The test passed.";
const MINUTE = 60_000;
const SUPERVISED: TaskLimits = { maxIterations: 5, maxDurationMs: 10 * MINUTE, maxActions: 200 };
const SMALL: TaskLimits = { maxIterations: 2, maxDurationMs: MINUTE, maxActions: 3 };

function counted(runs: Map<string, number>, tool: Omit<ToolDefinition, "execute">, result: () => unknown): ToolDefinition {
  return {
    ...tool,
    execute: async () => {
      runs.set(tool.name, (runs.get(tool.name) ?? 0) + 1);
      return result();
    },
  };
}

/** A browser action: clicking an element of the page. */
function click(runs: Map<string, number>): ToolDefinition {
  return counted(runs, { name: "click", description: "Clicks an element of the page.", parameters: { type: "object" }, browserAction: true }, () => "clicked");
}

/** A tool that is not a browser action and lets time pass. */
function readIndex(runs: Map<string, number>, clock: ManualClock, elapse = 0): ToolDefinition {
  return counted(runs, { name: "read_index", description: "Reads the index by domain.", parameters: { type: "object" } }, () => {
    clock.advance(elapse);
    return "index";
  });
}

/** A model reply that calls the named tools and, like a careless model, claims the test passed. */
const calls = (names: readonly string[]) =>
  toolCalls(
    MODEL,
    names.map((name, i) => ({ id: `call-${i + 1}`, name, arguments: {} })),
    CLAIM,
  );
const repeat = (count: number, name: string) => Array.from({ length: count }, () => name);
const iterations = (count: number) => [...Array.from({ length: count }, () => calls(["read_index"])), answer(MODEL, "The test passed.")];
const session =
  (limits: TaskLimits, tools: (clock: ManualClock, runs: Map<string, number>) => ToolDefinition[]) =>
  (clock: ManualClock, runs: Map<string, number>): SessionOptions => ({ instructions: "Test the application.", tools: tools(clock, runs), limits });

/** Every scripted scenario, by recording file name. */
export const SCENARIOS: Readonly<Record<string, Scenario>> = {
  "invalid-arguments.json": {
    purpose: "The model calls convert_price with arguments that do not match its schema, then gives up.",
    replies: [
      toolCalls(MODEL, [{ id: "call-1", name: "convert_price", arguments: { amount: "lots", currency: "GBP" } }]),
      answer(MODEL, "I could not convert the price."),
    ],
    message: TOOL_CALLING_CHECK.message,
    session: () => TOOL_CALLING_CHECK.session(),
  },
  "unknown-tool.json": {
    purpose: "The model calls a tool the session does not offer next to one it does, then answers.",
    replies: [
      toolCalls(MODEL, [
        { id: "call-1", name: "delete_everything", arguments: {} },
        { id: "call-2", name: "get_inventory", arguments: {} },
      ]),
      answer(MODEL, "There are 7 items in stock."),
    ],
    message: TOOL_CALLING_CHECK.message,
    session: () => TOOL_CALLING_CHECK.session(),
  },
  "limit-actions.json": {
    purpose: "Under the supervised limits, the model asks for 201 browser actions at once and claims success.",
    replies: [calls(repeat(201, "click")), answer(MODEL, "The test passed.")],
    message: "Click everything.",
    session: session(SUPERVISED, (_clock, runs) => [click(runs)]),
  },
  "limit-actions-mixed.json": {
    purpose: "With a limit of 3 actions, the model alternates browser actions and index reads.",
    replies: [calls(["click", "read_index", "click", "read_index", "click", "read_index", "click"]), answer(MODEL, "The test passed.")],
    message: "Click and read.",
    session: session(SMALL, (clock, runs) => [click(runs), readIndex(runs, clock)]),
  },
  "limit-iterations.json": {
    purpose: "Under the supervised limits, the model asks for a sixth model call.",
    replies: iterations(6),
    message: "Read the index again and again.",
    session: session(SUPERVISED, (clock, runs) => [readIndex(runs, clock)]),
  },
  "limit-iterations-small.json": {
    purpose: "With a limit of 2 iterations, the model asks for a third model call.",
    replies: iterations(3),
    message: "Read the index again and again.",
    session: session(SMALL, (clock, runs) => [readIndex(runs, clock)]),
  },
  "limit-duration.json": {
    purpose: "Under the supervised limits, a tool call lets 11 minutes pass before the next model call.",
    replies: iterations(2),
    message: "Read the index slowly.",
    session: session(SUPERVISED, (clock, runs) => [readIndex(runs, clock, 11 * MINUTE)]),
  },
  "limit-duration-small.json": {
    purpose: "With a limit of 1 minute, a tool call lets 61 seconds pass before the next model call.",
    replies: iterations(2),
    message: "Read the index slowly.",
    session: session(SMALL, (clock, runs) => [readIndex(runs, clock, MINUTE + 1000)]),
  },
};
