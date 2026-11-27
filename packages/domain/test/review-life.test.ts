import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { REVIEW_LIFE, reviewRefusalOf, reviewStatusAfter, type ReviewEvent, type ReviewStatus } from "../src/index.ts";

const STATUSES: readonly ReviewStatus[] = ["in_review", "validated", "set_aside"];
const EVENTS = Object.keys(REVIEW_LIFE) as ReviewEvent[];

describe("the life of a test to review", () => {
  it("validates or sets aside a test in review, puts one set aside back in review, and allows nothing else", () => {
    const table = Object.fromEntries(STATUSES.map((status) => [status, EVENTS.map((event) => reviewStatusAfter(event, status) ?? "refused")]));
    assert.deepEqual(EVENTS, ["validate", "set_aside", "restore"]);
    assert.deepEqual(table, {
      in_review: ["validated", "set_aside", "refused"],
      validated: ["refused", "refused", "refused"],
      set_aside: ["refused", "refused", "in_review"],
    });
  });

  it("says why a test is refused, from where it stands", () => {
    assert.deepEqual(
      STATUSES.map((status) => reviewRefusalOf("a.spec.ts", status)),
      [
        "The test a.spec.ts is in review already.",
        "The test a.spec.ts is validated already: it is in the working branch.",
        "The test a.spec.ts is set aside already.",
      ],
    );
  });
});
