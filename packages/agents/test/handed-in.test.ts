import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HandedIn, type SubmissionRules } from "../src/common/handed-in.ts";
import { Journal } from "../src/common/journal.ts";

/** What the test hands in: names to place, and how many other faults it holds. */
interface Listing {
  readonly placed: readonly string[];
  readonly faults: number;
}

const KNOWN = ["a", "b"];

/** Rules that want every known name placed, and refuse a listing for each fault it holds. */
const rules: SubmissionRules<Listing> = {
  tool: "submit_listing",
  what: "listing",
  secrets: [],
  description: "Hands the listing in.",
  shape: { type: "object" },
  validate: (args) => ({ ok: true, value: args as Listing }),
  check: (value) => {
    const missing = KNOWN.filter((name) => !value.placed.includes(name));
    const faults = Array.from({ length: value.faults }, (_, k) => ({ path: `/faults/${k}`, message: `fault ${k}` }));
    return {
      value,
      errors: [...faults, ...missing.map((name) => ({ path: "", message: `${name} is not placed.` }))],
      unplaced: new Map(missing.length === 0 ? [] : [["s", missing]]),
    };
  },
  leaveAside: (value, unplaced) => ({ ...value, placed: [...value.placed, ...[...unplaced.values()].flat()] }),
};

const handed = () => {
  const made = new HandedIn(rules, new Journal());
  return { made, submit: async (listing: Listing) => made.tool().execute(listing) };
};

describe("a result handed in with a tool", () => {
  it("reminds an agent that never submitted without any refusal, and answers a submission after the accepted one", async () => {
    const { made, submit } = handed();
    assert.equal(made.reminder(), "You have not handed in an accepted listing yet. Call submit_listing now.");
    await submit({ placed: KNOWN, faults: 0 });
    assert.deepEqual(
      [await submit({ placed: [], faults: 0 }), made.accepted, made.reminder()],
      ["The listing was already accepted; there is nothing more to do.", { placed: KNOWN, faults: 0 }, undefined],
    );
  });

  it("tells thirty errors at most, then how many more there are", async () => {
    const { submit } = handed();
    const refused = (await submit({ placed: KNOWN, faults: 32 })) as { error: string };
    assert.deepEqual(refused.error.split("\n").slice(-2), ["- fault 29", "- and 2 more"]);
  });

  it("does not place itself what is left when the submission holds another fault", async () => {
    const { made, submit } = handed();
    await submit({ placed: ["a"], faults: 1 });
    const second = (await submit({ placed: ["a"], faults: 1 })) as { error: string };
    assert.deepEqual([made.accepted, second.error.includes('- s: ["b"]')], [undefined, true]);
  });
});
