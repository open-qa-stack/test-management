import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlanReview, TestPlan } from "@open-qa-stack/domain";
import { Journal } from "../src/common/journal.ts";
import { PlanProposal } from "../src/designer/plan-proposal.ts";

const scenario = (id: string) => ({ id, title: `The ${id} scenario`, intent: `Verifies ${id}.`, kind: "functional" as const, expected: "The orders show.", sources: [{ source: "shop" }] });
const plan = (...ids: string[]): TestPlan => ({ scenarios: ids.map(scenario) });

/** A review that answers once both plans were submitted, so that the two are reviewed at once. */
function slowReview(decision: (plan: TestPlan) => boolean): PlanReview {
  return { review: async (submitted) => new Promise((resolve) => setTimeout(() => resolve(decision(submitted) ? { accepted: true } : { accepted: false, reason: "Not this one." }), 20)) };
}

const submit = (proposal: PlanProposal, submitted: TestPlan) => proposal.tool().execute(submitted) as Promise<string | { error: string }>;

describe("plans reviewed at once", () => {
  it("keep the first one accepted, and refuse the other", async () => {
    const journal = new Journal();
    const proposal = new PlanProposal({ sources: ["shop"], secrets: [], review: slowReview(() => true) }, journal);
    const [first, second] = await Promise.all([submit(proposal, plan("a", "b", "c")), submit(proposal, plan("x", "y", "z"))]);
    assert.match(String(first), /^The plan was accepted\./);
    assert.deepEqual(second, { error: "A plan was already accepted; carry it out." });
    assert.deepEqual(proposal.accepted, plan("a", "b", "c"));
    assert.equal(journal.entries().filter((entry) => entry.message.startsWith("The plan was accepted")).length, 1);
  });

  it("stop at the first refusal, and never keep the other", async () => {
    const proposal = new PlanProposal({ sources: ["shop"], secrets: [], review: slowReview((submitted) => submitted.scenarios[0]!.id === "x") }, new Journal());
    const [first, second] = await Promise.all([submit(proposal, plan("a", "b", "c")), submit(proposal, plan("x", "y", "z"))]);
    assert.deepEqual(first, { error: "The plan was refused: Not this one. The design is stopped; call no more tools." });
    assert.deepEqual(second, first);
    assert.deepEqual([proposal.accepted, proposal.refused], [undefined, "Not this one."]);
  });
});
