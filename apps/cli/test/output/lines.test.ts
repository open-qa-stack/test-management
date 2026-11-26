import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Session, SessionEvent, SessionResult, UnrankedEvent } from "@open-qa-stack/domain/sessions";
import { eventLine, MAX_FOLLOWED_LENGTH, ofTheAgents } from "../../src/index.ts";
import { exitCodeOf } from "../../src/sessions/session-exit.ts";
import { listedLine, summaryLines } from "../../src/output/session-lines.ts";
import { referredSession } from "../../src/sessions/session-reference.ts";
import { ThreadOutput } from "../../src/output/thread-output.ts";
import { UsageError } from "../../src/errors/usage-error.ts";
import { proposalLines, reviewLine } from "../../src/output/review-lines.ts";

const at = "2026-11-13T12:34:56.000Z";

/** An event without its date: the tests date them all alike. */
type Undated<Event> = Event extends unknown ? Omit<Event, "at"> : never;

/** An event of a thread, at the time of the tests, under a rank nothing reads. */
const told = (event: Undated<UnrankedEvent>): SessionEvent => ({ id: 1, at, ...event });

const RESULT: SessionResult = {
  outcome: "passed",
  durationMs: 512_345,
  modelRequests: 81,
  branch: "oqas/design-20261113T120130Z",
  tests: [
    { id: "shop › list-orders.spec.ts:3 › lists the orders", verdict: "passed", reason: "Every attempt passed." },
    { id: "shop › pay.spec.ts:3 › pays", verdict: "indeterminate", reason: "It did not run." },
  ],
};

const session = (more: Partial<Session> = {}): Session => ({
  id: "session-2026-11-13T12-00-00-000Z-9f3a1c2b",
  openedAt: at,
  lastEventAt: at,
  state: "running",
  ...more,
});

describe("an event of a session, as a person reads it in a terminal", () => {
  it("is written as the journal of a run always was when the harness tells a phase: what started, a note, a refusal with its code", () => {
    assert.equal(eventLine(told({ type: "phase_started", phase: "configuration" })), "[configuration] started");
    assert.equal(eventLine(told({ type: "phase_started", phase: "card", source: "order-specs" })), "[card] started: order-specs");
    assert.equal(eventLine(told({ type: "phase_started", phase: "write", scenario: "list-orders" })), "[write] started: list-orders");
    assert.equal(
      eventLine(told({ type: "note", phase: "summary", text: "The summary of the run was written." })),
      "[summary] The summary of the run was written.",
    );
    assert.equal(
      eventLine(told({ type: "refusal", phase: "prerequisites", text: "npm cannot be run; it installs the dependencies of the test repository." })),
      "[prerequisites] error: npm cannot be run; it installs the dependencies of the test repository.",
    );
    assert.equal(
      eventLine(told({ type: "refusal", phase: "plan", code: "PLAN-ELEMENT", text: "No such button." })),
      "[plan] error: [PLAN-ELEMENT] No such button.",
    );
  });

  it("says when, who and what for what a person and the agents did, each on one line", () => {
    assert.equal(eventLine(told({ type: "user_message", text: "Test the\n  orders." })), "12:34:56 person: Test the orders.");
    assert.equal(eventLine(told({ type: "user_message", text: "Search by last name.", number: 2 })), "12:34:56 person (message 2): Search by last name.");
    assert.equal(eventLine(told({ type: "message_delivered", message: 2, agent: "plan_reviewer" })), "12:34:56 message 2 delivered to the plan reviewer");
    assert.equal(eventLine(told({ type: "agent_message", agent: "planner", text: "Done.", reasoning: false })), "12:34:56 planner: Done.");
    assert.equal(eventLine(told({ type: "agent_message", agent: "writer", text: "I look first.", reasoning: true })), "12:34:56 writer thinks: I look first.");
    assert.equal(
      eventLine(told({ type: "harness_message", to: "code_reviewer", text: "The test: list-orders.spec.ts" })),
      "12:34:56 harness to the code reviewer: The test: list-orders.spec.ts",
    );
    assert.equal(
      eventLine(
        told({ type: "action_started", action: "a1", agent: "planner", tool: "shop_click", arguments: { target: { role: "button", name: "Search" } } }),
      ),
      '12:34:56 planner -> shop_click({"target":{"role":"button","name":"Search"}})',
    );
    assert.equal(
      eventLine(told({ type: "action_started", action: "a1", agent: "planner", tool: "shop_goto", arguments: undefined })),
      "12:34:56 planner -> shop_goto(undefined)",
    );
    assert.equal(
      eventLine(told({ type: "action_finished", action: "a1", outcome: "done", result: "One\n  order.", durationMs: 12 })),
      "12:34:56 <- One order.",
    );
    assert.equal(
      eventLine(told({ type: "action_finished", action: "a1", outcome: "failed", result: "No such button.", durationMs: 12 })),
      "12:34:56 !! No such button.",
    );
  });

  it("tells a plan that was accepted, a scenario that was closed and a change of state", () => {
    const scenario = (id: string) => ({ id, title: id, level: "functional" });
    assert.equal(eventLine(told({ type: "plan_accepted", scenarios: [scenario("test-1"), scenario("test-2")] })), "12:34:56 plan accepted: test-1, test-2");
    assert.equal(eventLine(told({ type: "plan_accepted", scenarios: [] })), "12:34:56 plan accepted: no scenario");
    assert.equal(
      eventLine(told({ type: "scope_resolved", environment: "local", applications: ["shop", "back-office"], levels: ["smoke", "functional"] })),
      "[configuration] scope: environment local; applications shop, back-office; levels smoke, functional",
    );
    assert.equal(eventLine(told({ type: "scenario_closed", scenario: "test-1", verdict: "passed" })), "12:34:56 scenario test-1 closed: passed");
    assert.equal(eventLine(told({ type: "state_changed", state: "completed" })), "12:34:56 session completed");
  });

  it("is cut when its text is long, and written as its type when this version does not know it", () => {
    assert.equal(
      eventLine(told({ type: "agent_message", agent: "planner", text: "x".repeat(MAX_FOLLOWED_LENGTH + 5), reasoning: false })),
      `12:34:56 planner: ${"x".repeat(MAX_FOLLOWED_LENGTH)}…`,
    );
    assert.equal(eventLine({ id: 1, at, type: "question_asked" } as unknown as SessionEvent), "12:34:56 question_asked");
  });

  it("is one of the work of the agents when it tells what one said, was asked or did, and one the harness tells otherwise", () => {
    const work = [
      told({ type: "agent_message", agent: "planner", text: "Done.", reasoning: false }),
      told({ type: "harness_message", to: "planner", text: "Plan." }),
      told({ type: "action_started", action: "a1", agent: "planner", tool: "shop_goto", arguments: {} }),
      told({ type: "action_finished", action: "a1", outcome: "done", result: "", durationMs: 1 }),
    ];
    const harness = [
      told({ type: "note", phase: "plan", text: "Noted." }),
      told({ type: "state_changed", state: "running" }),
      told({ type: "user_message", text: "Go." }),
    ];
    assert.deepEqual([...work, ...harness].map(ofTheAgents), [true, true, true, true, false, false, false]);
  });
});

describe("the thread of a session, as a command prints it", () => {
  const events = [
    told({ type: "phase_started", phase: "prerequisites" }),
    told({ type: "action_started", action: "a1", agent: "planner", tool: "shop_goto", arguments: {} }),
    told({ type: "phase_started", phase: "plan" }),
  ];
  /** What a thread writes of the events, and the last phase it says started. */
  const printed = (format: "text" | "json", follow: boolean) => {
    let written = "";
    const thread = new ThreadOutput({ write: (text) => (written += text) }, format, follow);
    const before = thread.lastPhase;
    for (const event of events) thread.event(event);
    return { written, before, last: thread.lastPhase };
  };

  it("holds what the harness tells alone unless it is followed, and remembers the last phase that started", () => {
    assert.deepEqual(printed("text", false), { written: "[prerequisites] started\n[plan] started\n", before: undefined, last: "plan" });
    assert.equal(printed("text", true).written, "[prerequisites] started\n12:34:56 planner -> shop_goto({})\n[plan] started\n");
  });

  it("holds every event whole, one a line, as JSON Lines, followed or not", () => {
    const expected = events.map((event) => `${JSON.stringify(event)}\n`).join("");
    assert.deepEqual([printed("json", false).written, printed("json", true).written], [expected, expected]);
  });
});

describe("a session, as a command writes it", () => {
  it("is one line of the list: its identifier, how it stands, when it was opened, and what was asked on one line", () => {
    assert.equal(listedLine(session({ request: "Test the\n orders." })), `session-2026-11-13T12-00-00-000Z-9f3a1c2b  running  ${at}  Test the orders.`);
    assert.equal(listedLine(session({ state: "completed", result: RESULT })), `session-2026-11-13T12-00-00-000Z-9f3a1c2b  completed, passed  ${at}`);
    assert.equal(listedLine(session({ purpose: "map" })), `session-2026-11-13T12-00-00-000Z-9f3a1c2b  running  ${at}  maps the knowledge`);
  });

  it("is summed up by how it stands, then by what it took, the branch of its tests and each verdict once it is completed", () => {
    assert.deepEqual(summaryLines(session({ state: "interrupted" })), ["Session session-2026-11-13T12-00-00-000Z-9f3a1c2b: interrupted."]);
    assert.deepEqual(summaryLines(session({ state: "completed", result: RESULT })), [
      "Session session-2026-11-13T12-00-00-000Z-9f3a1c2b: completed, passed, in 512.3 s and 81 model requests.",
      "Tests written on the branch oqas/design-20261113T120130Z.",
      "passed        shop › list-orders.spec.ts:3 › lists the orders",
      "indeterminate shop › pay.spec.ts:3 › pays",
    ]);
    const { branch: _branch, ...unbranched } = RESULT;
    assert.equal(summaryLines(session({ state: "completed", result: { ...unbranched, tests: [] } })).length, 1);
  });

  it("gives the exit code of its run: how it ended when it is completed, the phase it stopped in when it is interrupted", () => {
    const ended = (outcome: string) => session({ state: "completed", result: { ...RESULT, outcome: outcome as SessionResult["outcome"] } });
    assert.deepEqual(
      ["passed", "failed", "inconclusive", "stopped", "a later outcome"].map((outcome) => exitCodeOf(ended(outcome), "summary")),
      [0, 1, 2, 5, 5],
    );
    const interrupted = session({ state: "interrupted" });
    assert.deepEqual(
      [exitCodeOf(interrupted, "configuration"), exitCodeOf(interrupted, "prerequisites"), exitCodeOf(interrupted, "plan"), exitCodeOf(interrupted, undefined)],
      [3, 4, 5, 5],
    );
  });
});

describe("what a person gives to name a session", () => {
  const first = session({ id: "session-2026-11-13T12-00-00-000Z-9f3a1c2b" });
  const second = session({ id: "session-2026-11-13T12-05-00-000Z-0b7e9f3a" });
  const within = session({ id: "session-2026-11-13T12" });

  it("is its identifier, or the start or the end of it when no other session shares it", () => {
    assert.equal(referredSession([first, second], first.id), first);
    assert.equal(referredSession([first, second], "1c2b"), first);
    assert.equal(referredSession([first, second], "session-2026-11-13T12-05"), second);
    assert.equal(referredSession([first, second, within], "session-2026-11-13T12"), within, "a whole identifier names its session, whatever it starts");
  });

  it("is refused when it names no session, or more than one, which it lists", () => {
    const refused = (reference: string, message: string) =>
      assert.throws(
        () => referredSession([first, second], reference),
        (error) => error instanceof UsageError && error.name === "UsageError" && error.message === message,
      );
    refused("0000", "No session 0000; oqas sessions lists them.");
    refused("session-2026", `session-2026 names 2 sessions: ${first.id}, ${second.id}. Give more of the identifier.`);
  });
});

describe("the lines of the review", () => {
  const test = {
    id: "11111111-1111-4111-8111-111111111111",
    path: "apps/shop/tests/orders/listing/list-orders.spec.ts",
    title: "The orders are listed",
    application: "shop",
    domain: "orders",
    feature: "listing",
    level: "functional",
    kind: "functional",
    branch: "oqas/design-20261127T090000Z",
    designedAt: "2026-11-27T09:00:00.000Z",
    verdict: "failed",
    runs: 2,
    reviewed: true,
    remarkCount: 2,
    status: "set_aside",
  } as const;

  it("say each test of the queue with its status, where it comes from and how it went", () => {
    assert.equal(
      reviewLine(test),
      "11111111-1111-4111-8111-111111111111  set aside  The orders are listed  (shop › orders, functional; failed after 2 runs; reviewed, 2 remarks)",
    );
    assert.match(reviewLine({ ...test, status: "validated", runs: 1, remarkCount: 1 }), /  validated  .*after 1 run; reviewed, 1 remark\)$/);
  });

  it("say what is read to decide of a test, with or without a brief, sources and remarks", () => {
    const proposal = {
      ...test,
      status: "in_review",
      brief: "The orders.",
      intent: "Verify the orders are listed.",
      sources: [{ source: "order-specs", item: "Orders" }, { source: "shop" }],
      steps: [
        { action: "Open the orders", expects: ["The orders show"] },
        { action: "Close them", expects: [] },
      ],
      reason: "Its last run failed.",
      remarks: [
        { about: "coherence", where: "step 1", what: "It does not check the total." },
        { about: "code", where: "line 3", what: "Use a role.", rule: "PW-LOC-01" },
      ],
      files: [{ path: "apps/shop/tests/orders/listing/list-orders.spec.ts", content: "", added: 9 }],
    } as const;
    assert.deepEqual(proposalLines(proposal).slice(1), [
      "apps/shop/tests/orders/listing/list-orders.spec.ts, on oqas/design-20261127T090000Z",
      "Asked: The orders.",
      "Why: Verify the orders are listed.",
      "Sources: order-specs — Orders, shop",
      "1. Open the orders",
      "   expects: The orders show",
      "2. Close them",
      "Stands so: Its last run failed.",
      "Remark on its coherence, step 1: It does not check the total.",
      "Remark on its code, line 3 (PW-LOC-01): Use a role.",
      "Files: apps/shop/tests/orders/listing/list-orders.spec.ts (+9)",
    ]);
    const { brief: _, ...bare } = proposal;
    assert.deepEqual(proposalLines({ ...bare, reviewed: false, sources: [], remarks: [] }).slice(0, 4), [
      "11111111-1111-4111-8111-111111111111  to review  The orders are listed  (shop › orders, functional; failed after 2 runs; not reviewed)",
      "apps/shop/tests/orders/listing/list-orders.spec.ts, on oqas/design-20261127T090000Z",
      "Why: Verify the orders are listed.",
      "Sources: none",
    ]);
  });
});
