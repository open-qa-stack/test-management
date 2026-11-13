import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { repeatedText } from "../src/designer/refusal.ts";
import { RefusalStreak } from "../src/designer/refusal-streak.ts";

const refusal = (code: string, remedy?: string) => ({ code, message: `the ${code} gate refuses.`, ...(remedy === undefined ? {} : { remedy }) });

describe("the refusals of one scenario", () => {
  it("count each code once per call, the alternating ones too, until the agent makes progress", () => {
    const streak = new RefusalStreak();
    streak.record([refusal("A"), refusal("A"), refusal("B")]);
    streak.record([refusal("B")]);
    streak.record([refusal("A")]);
    assert.deepEqual(streak.repeated([refusal("A")]), { code: "A", times: 2 });
    streak.record([refusal("B"), refusal("A")]);
    // Codes refused as often: the first of the call.
    assert.deepEqual(streak.repeated([refusal("B"), refusal("A")]), { code: "B", times: 3 });
    streak.record([refusal("B")]);
    assert.deepEqual(streak.repeated([refusal("A"), refusal("B")]), { code: "B", times: 4 });
    streak.reset();
    streak.record([refusal("A")]);
    assert.deepEqual(streak.repeated([refusal("A")]), { code: "A", times: 1 });
  });
});

describe("a reason refused three times or more", () => {
  it("is told by what the gate would accept, each remedy once, and nothing of the other reasons", () => {
    const refusals = [refusal("TEST-VALUE", "In step 1: assert it."), refusal("TEST-LOCATOR"), refusal("TEST-VALUE", "In step 1: assert it."), refusal("TEST-VALUE", "In step 2: assert that.")];
    assert.equal(repeatedText("TEST-VALUE", 3, refusals), "Third refusal for the same reason. Do only this:\nIn step 1: assert it.\nIn step 2: assert that.");
  });

  it("is told by its first error alone when its gate gives nothing else", () => {
    assert.equal(repeatedText("TEST-LOCATOR", 4, [refusal("TEST-VALUE", "Assert it."), refusal("TEST-LOCATOR"), refusal("TEST-LOCATOR")]), "Fourth refusal for the same reason. Do only this:\nRefused (TEST-LOCATOR): the TEST-LOCATOR gate refuses.");
    assert.match(repeatedText("PLAN-ID", 5, [refusal("PLAN-ID")]), /^Fifth refusal for the same reason\./);
  });
});
