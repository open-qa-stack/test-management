import assert from "node:assert/strict";
import type { Session, SessionResult, SessionTest } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { stateOf, testsText, waitText } from "../../src/agent/session-facts.ts";
import { COMPLETED, QUEUED, RUNNING } from "./session-fixture.ts";

/**
 * The session of the fixtures, completed with a result of its own.
 *
 * @param changes - What differs from the result of the fixtures.
 * @returns The session.
 */
const endedWith = (changes: Partial<SessionResult>): Session => ({ ...COMPLETED, result: { ...COMPLETED.result!, ...changes } });

/** A session completed whose result the API has not told. */
const UNTOLD: Session = { ...RUNNING, state: "completed" };

describe("the state of a session", () => {
  it("reads as queued while it waits its turn, in a tone that is neither the one of success nor the one of live", () => {
    assert.deepEqual(stateOf(QUEUED), { tone: "outline", label: "en file" });
  });

  it("reads as live while its agents work, as interrupted when it stopped", () => {
    assert.deepEqual(stateOf(RUNNING), { tone: "info", label: "en direct" });
    assert.deepEqual(stateOf({ ...COMPLETED, state: "interrupted" }), { tone: "warn", label: "interrompue" });
  });

  it("reads as how the session ended once it is completed", () => {
    assert.deepEqual(stateOf(COMPLETED), { tone: "ok", label: "tests réussis" });
    assert.deepEqual(stateOf(endedWith({ outcome: "failed" })), { tone: "ko", label: "test en échec" });
    assert.deepEqual(stateOf(endedWith({ outcome: "inconclusive" })), { tone: "warn", label: "test sans verdict" });
    assert.deepEqual(stateOf(endedWith({ outcome: "stopped" })), { tone: "neutral", label: "arrêtée avant la fin" });
  });

  it("reads as ended, no more, when a completed session has no result", () => {
    assert.deepEqual(stateOf(UNTOLD), { tone: "neutral", label: "terminée" });
  });

  it("reads as ended, no more, when the API tells a state or a way of ending this console does not know", () => {
    assert.deepEqual(stateOf({ ...RUNNING, state: "archived" as Session["state"] }), { tone: "neutral", label: "terminée" });
    assert.deepEqual(stateOf(endedWith({ outcome: "abandoned" as SessionResult["outcome"] })), { tone: "neutral", label: "terminée" });
    assert.deepEqual(stateOf({ ...COMPLETED, state: "archived" as Session["state"] }), { tone: "ok", label: "tests réussis" });
  });
});

describe("what a session waits for", () => {
  it("is an agent while it is queued, and nothing in any other state", () => {
    assert.equal(waitText(QUEUED), "en attente d’un agent");
    assert.deepEqual([RUNNING, COMPLETED, { ...RUNNING, state: "archived" as Session["state"] }].map(waitText), [undefined, undefined, undefined]);
  });
});

describe("the tests of a session", () => {
  it("are counted as how many passed out of how many", () => {
    assert.equal(testsText(COMPLETED), "1 / 1 test réussi");
    const tests: SessionTest[] = [
      { id: "a", verdict: "passed", reason: "" },
      { id: "b", verdict: "failed", reason: "" },
      { id: "c", verdict: "blocked", reason: "" },
    ];
    assert.equal(testsText(endedWith({ outcome: "failed", tests })), "1 / 3 tests réussis");
  });

  it("are not counted when the session has no result, or a result without a test", () => {
    assert.equal(testsText(RUNNING), undefined);
    assert.equal(testsText(endedWith({ outcome: "stopped", tests: [] })), undefined);
  });
});
