import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { MAX_CORRECTION, MAX_SET_ASIDE_NOTE, reviewCorrectionOf, reviewDecisionOf } from "../src/index.ts";

describe("a decision of the review, as a client sends it", () => {
  it("validates a test, or sets it aside with a reason, the test that covers it for one covered, and a note, each trimmed", () => {
    assert.deepEqual(reviewDecisionOf({ status: "validated", reason: "ignored" }), { status: "validated" });
    assert.deepEqual(reviewDecisionOf({ status: "set_aside", reason: "out_of_scope", coveredBy: "a.spec.ts", note: "  Not ours.  " }), {
      status: "set_aside",
      reason: "out_of_scope",
      note: "Not ours.",
    });
    assert.deepEqual(reviewDecisionOf({ status: "set_aside", reason: "covered", coveredBy: " apps/x.spec.ts ", note: "  " }), {
      status: "set_aside",
      reason: "covered",
      coveredBy: "apps/x.spec.ts",
    });
  });

  it("is refused with why: no decision, a status or a reason not known, a test covered by none, a note too long", () => {
    assert.equal(reviewDecisionOf("validated"), 'A decision is { "status": "validated" } or { "status": "set_aside", "reason" }.');
    assert.equal(reviewDecisionOf({ status: "approved" }), 'The status of a decision is "validated" or "set_aside".');
    assert.equal(
      reviewDecisionOf({ status: "set_aside", reason: "boring" }),
      "The reason a test is set aside is one of covered, out_of_scope, wrong_oracle, wrong_level.",
    );
    assert.equal(
      reviewDecisionOf({ status: "set_aside", reason: "covered", coveredBy: 3 }),
      "A test set aside as covered names the test that covers it, in coveredBy.",
    );
    assert.equal(
      reviewDecisionOf({ status: "set_aside", reason: "wrong_level", note: "x".repeat(MAX_SET_ASIDE_NOTE + 1) }),
      `The note of a test set aside is ${MAX_SET_ASIDE_NOTE} characters at most.`,
    );
  });
});

describe("a correction of a test, as a client sends it", () => {
  it("is what to change, trimmed, and is refused without it or when too long", () => {
    assert.deepEqual(reviewCorrectionOf({ instruction: "  Use the policy of Max.  " }), { instruction: "Use the policy of Max." });
    assert.deepEqual(reviewCorrectionOf({ instruction: "x", remember: true }), { instruction: "x", remember: true });
    assert.deepEqual(reviewCorrectionOf({ instruction: "x", remember: "yes" }), { instruction: "x" });
    const refused = `A correction is { "instruction", "remember"? }: what to change in the test, 1 to ${MAX_CORRECTION} characters.`;
    for (const body of [null, {}, { instruction: " " }, { instruction: 3 }, { instruction: "x".repeat(MAX_CORRECTION + 1) }])
      assert.equal(reviewCorrectionOf(body), refused);
  });
});
