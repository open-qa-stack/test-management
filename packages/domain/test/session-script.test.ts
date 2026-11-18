import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  scriptOf,
  type ActionFinishedEvent,
  type AgentRole,
  type ScriptWording,
  type Session,
  type SessionEvent,
  type SessionPhase,
  type Step,
  type UnrankedEvent,
} from "../src/sessions/index.ts";

/** An event without its rank nor its date, which the tests give in order. */
type EventBody = UnrankedEvent extends infer Event ? (Event extends unknown ? Omit<Event, "at"> : never) : never;

const RUNNING: Session = {
  id: "session-1",
  request: "Test the search.",
  openedAt: "2026-11-13T14:44:05.000Z",
  lastEventAt: "2026-11-13T14:44:06.000Z",
  state: "running",
};
const UNASKED: Session = { id: "session-1", openedAt: RUNNING.openedAt, lastEventAt: RUNNING.lastEventAt, state: "running" };
const INTERRUPTED: Session = { ...RUNNING, state: "interrupted" };

/** The words of a presentation that says each thing as what it is. */
const WORDING: ScriptWording = {
  phase: (phase) => `phase ${phase}`,
  tool: (tool, args) => `${tool} ${JSON.stringify(args)}`,
  planAccepted: "plan accepted",
  interrupted: "interrupted",
  verdicts: (tests) => `${tests} verdicts`,
  closed: (scenarios) => `${scenarios} closed`,
  opened: (day, time) => `opened ${day} ${time}`,
};

/** Ranks events from 1 and dates them a second apart, from 14:44:06. */
function numbered(bodies: readonly EventBody[]): SessionEvent[] {
  return bodies.map((body, index) => ({ ...body, id: index + 1, at: `2026-11-13T14:44:${String(6 + index).padStart(2, "0")}.000Z` }) as SessionEvent);
}

/** The steps of a session whose events are given without rank nor date. */
function stepsOf(bodies: readonly EventBody[], session: Session = RUNNING): readonly Step[] {
  return scriptOf(session, numbered(bodies), WORDING).steps;
}

describe("the script of a session", () => {
  it("carries the identifier of the session, and where it is: queued, live while its agents work, ended in any other state", () => {
    const stages = [{ ...RUNNING, state: "queued" as const }, RUNNING, INTERRUPTED, { ...RUNNING, state: "archived" as Session["state"] }].map(
      (session) => scriptOf(session, [], WORDING).stage,
    );
    assert.deepEqual(stages, ["queued", "live", "ended", "ended"]);
    assert.equal(scriptOf(RUNNING, [], WORDING).id, "session-1");
  });

  it("is titled after what the session was asked, on one line and whole; after the first message of the person; or after its opening", () => {
    assert.equal(scriptOf({ ...RUNNING, request: "  test\n  the search " }, [], WORDING).title, "test the search");
    assert.equal(scriptOf({ ...RUNNING, request: "r".repeat(4000) }, [], WORDING).title, "r".repeat(4000));
    const said = numbered([
      { type: "user_message", text: "a correction", number: 1 },
      { type: "user_message", text: "the request" },
      { type: "user_message", text: "another" },
    ]);
    assert.equal(scriptOf(UNASKED, said, WORDING).title, "the request");
    assert.equal(scriptOf(UNASKED, said.slice(0, 1), WORDING).title, "opened 2026-11-13 14:44:05");
  });

  it("tells what the person, the harness and an agent said, a reasoning apart, a message sent since with its number and its delivery", () => {
    assert.deepEqual(
      stepsOf([
        { type: "user_message", text: "Test the search." },
        { type: "harness_message", to: "planner", text: "Plan it." },
        { type: "agent_message", agent: "planner", text: "I look first.", reasoning: true },
        { type: "agent_message", agent: "planner", text: "Here is the plan.", reasoning: false },
        { type: "user_message", text: "Without the profile.", number: 1 },
        { type: "message_delivered", message: 1, agent: "planner" },
      ]),
      [
        { kind: "say", from: "user", at: "14:44:06", text: "Test the search." },
        { kind: "say", from: "harness", to: "planner", at: "14:44:07", text: "Plan it." },
        { kind: "say", from: "planner", at: "14:44:08", text: "I look first.", thinking: true },
        { kind: "say", from: "planner", at: "14:44:09", text: "Here is the plan." },
        { kind: "say", from: "user", at: "14:44:10", text: "Without the profile.", number: 1 },
        { kind: "delivery", at: "14:44:11", message: 1, to: "planner" },
      ],
    );
  });

  it("starts a pass at each phase, a review or a writing as a part, and none for the work on one source, which it counts once", () => {
    const script = scriptOf(
      RUNNING,
      numbered([
        { type: "phase_started", phase: "configuration" },
        { type: "phase_started", phase: "card", source: "order-specs" },
        { type: "phase_started", phase: "card", source: "order-specs" },
        { type: "phase_started", phase: "review" },
        { type: "phase_started", phase: "write", scenario: "search" },
        { type: "phase_started", phase: "later" as SessionPhase },
      ]),
      WORDING,
    );
    assert.deepEqual(script.sources, ["order-specs"]);
    assert.deepEqual(script.steps, [
      { kind: "pass", at: "14:44:06", title: "phase configuration", summary: "" },
      { kind: "pass", at: "14:44:09", title: "phase review", summary: "", minor: true },
      { kind: "pass", at: "14:44:10", title: "phase write", summary: "search", minor: true },
      { kind: "pass", at: "14:44:11", title: "phase later", summary: "" },
    ]);
  });

  it("names the plan that is open after the level its request asks for, never an earlier one, and nothing when a level comes outside a plan", () => {
    const titles = (bodies: readonly EventBody[]): string[] => stepsOf(bodies).flatMap((step) => (step.kind === "pass" ? [step.title] : []));
    assert.deepEqual(
      titles([
        { type: "harness_message", to: "planner", text: "Too early.", level: "smoke" },
        { type: "phase_started", phase: "plan" },
        { type: "harness_message", to: "planner", text: "No level." },
        { type: "phase_started", phase: "plan" },
        { type: "harness_message", to: "planner", text: "Plan the functional tests.", level: "functional" },
      ]),
      ["phase plan", "phase plan · functional"],
    );
  });

  it("makes one step of an action and its end, by its identifier: pending until the tool answered, then with its answer, its duration, its outcome and what the agent looked at", () => {
    const look = { kind: "page", name: "http://localhost/", lines: ["- heading"] } as const;
    assert.deepEqual(
      stepsOf([
        { type: "action_started", action: "a", agent: "planner", tool: "shop_goto", arguments: { url: "/" } },
        { type: "action_started", action: "b", agent: "planner", tool: "propose_plan", arguments: {} },
        { type: "action_started", action: "c", agent: "writer", tool: "run_test", arguments: {} },
        { type: "action_finished", action: "b", outcome: "failed", result: " Refused:\n name an element. ", durationMs: 40 },
        { type: "action_finished", action: "a", outcome: "done", result: "Opened.", durationMs: 900, look },
        { type: "action_finished", action: "lost", outcome: "passed", result: "Lost.", durationMs: 1 },
        { type: "action_started", action: "d", agent: "writer", tool: "run_test", arguments: {} },
        { type: "action_finished", action: "d", outcome: "flaky" as ActionFinishedEvent["outcome"], result: "1 flaky", durationMs: 10 },
        { type: "action_started", action: "e", agent: "writer", tool: "propose_test", arguments: {} },
        { type: "action_finished", action: "e", outcome: "passed", result: "Kept.", durationMs: 5 },
      ]),
      [
        { kind: "tool", from: "planner", at: "14:44:06", tool: "shop_goto", title: 'shop_goto {"url":"/"}', detail: "Opened.", durationMs: 900, look },
        {
          kind: "tool",
          from: "planner",
          at: "14:44:07",
          tool: "propose_plan",
          title: "propose_plan {}",
          detail: "Refused:\n name an element.",
          durationMs: 40,
          outcome: "failed",
        },
        { kind: "tool", from: "writer", at: "14:44:08", tool: "run_test", title: "run_test {}", pending: true },
        { kind: "tool", from: "writer", at: "14:44:12", tool: "run_test", title: "run_test {}", detail: "1 flaky", durationMs: 10 },
        { kind: "tool", from: "writer", at: "14:44:14", tool: "propose_test", title: "propose_test {}", detail: "Kept.", durationMs: 5, outcome: "passed" },
      ],
    );
  });

  it("ignores the end of an action whose start is no longer one, an event of a type it does not know, and what an agent it does not know says or is asked", () => {
    const stranger = "auditor" as AgentRole;
    assert.deepEqual(
      stepsOf([
        { type: "agent_message", agent: stranger, text: "Hello.", reasoning: false },
        { type: "harness_message", to: stranger, text: "Audit it." },
        { type: "action_started", action: "a", agent: stranger, tool: "tests_list", arguments: {} },
        { type: "message_delivered", message: 1, agent: stranger },
        { type: "archived" } as unknown as EventBody,
        { type: "state_changed", state: "running" },
      ]),
      [],
    );
  });

  it("lists the scenarios of a plan the harness accepted, tells a refusal as a verdict with the code of its gate when it has one, and a note as a line", () => {
    assert.deepEqual(
      stepsOf([
        {
          type: "plan_accepted",
          scenarios: [
            { id: "search", title: "Search a customer", level: "smoke", case: "nominal", application: "shop" },
            { id: "open", title: "Open a customer", level: "functional" },
          ],
        },
        { type: "refusal", phase: "plan", code: "PLAN-ELEMENT", text: "Name an element." },
        { type: "refusal", phase: "write", text: "The run failed." },
        { type: "note", phase: "plan", text: " The plan\n was accepted. " },
      ]),
      [
        {
          kind: "plan",
          at: "14:44:06",
          title: "plan accepted",
          scenarios: [
            { priority: "smoke", title: "Search a customer", source: "nominal · shop" },
            { priority: "functional", title: "Open a customer", source: "" },
          ],
        },
        { kind: "verdict", at: "14:44:07", accepted: false, code: "PLAN-ELEMENT", about: "phase plan", text: "Name an element." },
        { kind: "verdict", at: "14:44:08", accepted: false, about: "phase write", text: "The run failed." },
        { kind: "note", at: "14:44:09", text: "The plan\n was accepted." },
      ],
    );
  });

  it("keeps every text whole, with its lines: a message, a refusal, a note, the title and the answer of an action", () => {
    const long = Array.from({ length: 300 }, (_, rank) => `line ${rank} ${"x".repeat(80)}`).join("\n");
    const steps = stepsOf([
      { type: "harness_message", to: "planner", text: long },
      { type: "refusal", phase: "plan", text: long },
      { type: "note", phase: "plan", text: long },
      { type: "agent_message", agent: "planner", text: long, reasoning: false },
      { type: "action_started", action: "a", agent: "planner", tool: "t", arguments: long },
      { type: "action_finished", action: "a", outcome: "done", result: long, durationMs: 1 },
    ]);
    assert.deepEqual(
      steps.slice(0, 4).map((step) => "text" in step && step.text),
      [long, long, long, long],
    );
    const action = steps[4];
    assert.ok(action?.kind === "tool");
    assert.equal(action.detail, long);
    assert.equal(action.title, `t ${JSON.stringify(long)}`);
  });

  it("tells an interruption, and no other change of state", () => {
    assert.deepEqual(
      stepsOf(
        [
          { type: "state_changed", state: "running" },
          { type: "state_changed", state: "interrupted" },
        ],
        INTERRUPTED,
      ),
      [{ kind: "note", at: "14:44:07", text: "interrupted" }],
    );
  });

  it("closes, once the session ended, on the verdict of each test of its result, named by its title alone, at the time of the last step", () => {
    const completed: Session = {
      ...RUNNING,
      state: "completed",
      result: {
        outcome: "failed",
        durationMs: 1000,
        modelRequests: 3,
        tests: [
          { id: "shop › tests/search.spec.ts:3 › searches a customer", verdict: "passed", reason: "It passed." },
          { id: "opens a customer", verdict: "blocked", reason: "The application did not answer." },
        ],
      },
    };
    const events: readonly EventBody[] = [
      { type: "note", phase: "execution", text: "The tests ran." },
      { type: "scenario_closed", scenario: "search", level: "smoke", verdict: "passed" },
    ];
    assert.deepEqual(stepsOf(events, completed).at(-1), {
      kind: "outcome",
      at: "14:44:06",
      title: "2 verdicts",
      tests: [
        { title: "searches a customer", level: "", verdict: "passed", note: "It passed." },
        { title: "opens a customer", level: "", verdict: "blocked", note: "The application did not answer." },
      ],
    });
    // While the session goes on, or when it left no step, it closes on nothing.
    assert.equal(stepsOf(events, { ...completed, state: "running" }).length, 1);
    assert.deepEqual(stepsOf([], completed), []);
  });

  it("closes on the scenarios the harness closed when no test ran, and on nothing when none was", () => {
    const events: readonly EventBody[] = [
      { type: "scenario_closed", scenario: "search", level: "smoke", verdict: "passed" },
      { type: "scenario_closed", scenario: "open", verdict: "failed" },
      { type: "state_changed", state: "interrupted" },
    ];
    assert.deepEqual(stepsOf(events, INTERRUPTED).at(-1), {
      kind: "outcome",
      at: "14:44:08",
      title: "2 closed",
      tests: [
        { title: "search", level: "smoke", verdict: "passed" },
        { title: "open", level: "", verdict: "failed" },
      ],
    });
    assert.equal(stepsOf(events, RUNNING).length, 1);
    assert.equal(stepsOf(events.slice(2), INTERRUPTED).length, 1);
    assert.deepEqual(stepsOf(events.slice(0, 2), INTERRUPTED), []);
  });
});
