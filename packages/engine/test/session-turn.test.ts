import assert from "node:assert/strict";
import type { SessionEvent, SessionResult, UnrankedEvent } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { sessionTurn } from "../src/sessions/session-turn.ts";

/** An event without its rank nor its date. */
type EventBody = UnrankedEvent extends infer Event ? (Event extends unknown ? Omit<Event, "at"> : never) : never;

/** Ranks events from 1, all at the same date. */
const ranked = (events: readonly EventBody[]): SessionEvent[] =>
  events.map((event, index) => ({ ...event, id: index + 1, at: "2026-11-18T09:00:00.000Z" }) as SessionEvent);

const FAILED: SessionResult = {
  outcome: "failed",
  durationMs: 1000,
  modelRequests: 3,
  branch: "oqas/design-first",
  tests: [
    { id: "shop › tests/search.spec.ts:3 › searches a customer", verdict: "passed", reason: "Every attempt passed." },
    { id: "shop › tests/open.spec.ts:3 › opens a customer", verdict: "failed", reason: "No row named Ada." },
  ],
};

describe("the turn of a session that starts", () => {
  it("is the first one: its run is asked what opened the session, and goes on with no branch", () => {
    assert.deepEqual(sessionTurn("Test the search.", ranked([{ type: "user_message", text: "Test the search." }])), { brief: "Test the search." });
    assert.deepEqual(sessionTurn(undefined, []), {});
  });

  it("resumes the session: its run is asked what the person asks now, after what the turns before did, and goes on with their branch", () => {
    const events = ranked([
      { type: "user_message", text: "Test the search." },
      { type: "state_changed", state: "running" },
      { type: "user_message", text: "Only the active customers.", number: 1 },
      { type: "message_delivered", message: 1, agent: "planner" },
      { type: "user_message", text: "Too late for anyone.", number: 2 },
      { type: "state_changed", state: "completed", result: FAILED },
      { type: "user_message", text: "Add a scenario for the export." },
      { type: "state_changed", state: "queued" },
      { type: "state_changed", state: "running" },
      { type: "state_changed", state: "interrupted" },
      { type: "user_message", text: "Fix the failing test." },
      { type: "state_changed", state: "queued" },
    ]);
    assert.deepEqual(sessionTurn("Test the search.", events), {
      brief: [
        "This session already had turns of work in this test repository, and the person asks for one more.",
        "What the session was asked first:\nTest the search.",
        "What the person asked of the turns since, in order:\n- Add a scenario for the export.",
        "What the person said to the agents during those turns:\n- Only the active customers.",
        [
          "What the last turn that completed came to: failed. The verdicts of its tests:",
          "- shop › tests/search.spec.ts:3 › searches a customer: passed. Every attempt passed.",
          "- shop › tests/open.spec.ts:3 › opens a customer: failed. No row named Ada.",
        ].join("\n"),
        "The tests of the turns before are on the branch oqas/design-first, which this turn goes on with.",
        "What the person asks of this turn:\nFix the failing test.",
      ].join("\n\n"),
      branch: "oqas/design-first",
    });
  });

  it("says that the last turn ran no test, keeps the branch of an earlier one, and leaves out what no turn did", () => {
    const later: SessionResult = { outcome: "passed", durationMs: 10, modelRequests: 1, tests: [] };
    const resumed = (results: readonly SessionResult[]) =>
      sessionTurn(
        "Test the search.",
        ranked([
          { type: "user_message", text: "Test the search." },
          ...results.map((result) => ({ type: "state_changed", state: "completed", result }) as const),
          { type: "user_message", text: "Go on." },
        ]),
      );
    const { brief, branch } = resumed([FAILED, later]);
    assert.match(
      String(brief),
      /What the last turn that completed came to: passed\. It ran no test\.\n\nThe tests of the turns before are on the branch oqas\/design-first/,
    );
    assert.equal(branch, "oqas/design-first");
    assert.deepEqual(resumed([]), {
      brief: [
        "This session already had turns of work in this test repository, and the person asks for one more.",
        "What the session was asked first:\nTest the search.",
        "What the person asks of this turn:\nGo on.",
      ].join("\n\n"),
    });
  });
});
