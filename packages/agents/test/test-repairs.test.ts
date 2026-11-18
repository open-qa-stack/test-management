import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { PlannedScenario } from "@open-qa-stack/domain";
import { Journal } from "../src/common/journal.ts";
import { TestRepairs } from "../src/designer/test-repairs.ts";

/** A scenario of an earlier plan; only its identifier matters here. */
const scenario = (id: string) => ({ id }) as PlannedScenario;

const A = "apps/shop/tests/orders/listing/a.spec.ts";
const B = "apps/shop/tests/orders/listing/b.spec.ts";
const C = "apps/shop/tests/orders/search/a.spec.ts";
const PLANNED = new Map([
  [A, scenario("a")],
  [B, scenario("b")],
  [C, scenario("a")],
]);

/** Asks for the repair of tests, with the repairs the call is made to. */
async function ask(repairs: TestRepairs, ...paths: string[]): Promise<unknown> {
  return repairs.tool().execute({ paths });
}

describe("the repair of tests the repository has", () => {
  it("is asked once, for the tests a design wrote, each with the scenario of its plan, and journaled", async () => {
    const journal = new Journal();
    const repairs = new TestRepairs(PLANNED, [A, B, C], () => false, journal);
    assert.equal(repairs.chosen, undefined);
    assert.deepEqual(await ask(repairs, B, A, B), { accepted: true, next: repairs.closed() });
    assert.deepEqual(repairs.chosen, [
      { path: B, scenario: scenario("b") },
      { path: A, scenario: scenario("a") },
    ]);
    assert.deepEqual(journal.entries(), [{ level: "info", message: `The tests to repair: ${B}, ${A}.` }]);
  });

  it("is refused once scenarios of a plan were submitted: a design plans or repairs", async () => {
    const repairs = new TestRepairs(PLANNED, [A], () => true, new Journal());
    assert.deepEqual(await ask(repairs, A), {
      error:
        "Refused (REPAIR-PLANNED): scenarios of a plan were submitted already: a design plans new tests or repairs those that exist, not both. Go on with propose_plan.\nNothing else was refused.",
    });
    assert.equal(repairs.chosen, undefined);
  });

  it("is refused for two tests of scenarios of the same name, from different plans", async () => {
    const repairs = new TestRepairs(PLANNED, [A, B, C], () => false, new Journal());
    assert.deepEqual(await ask(repairs, A, B, C), {
      error: `Refused (REPAIR-SAME-SCENARIO): ${A}, ${C} were written for scenarios of the same name, in different plans: ask for the repair of one of them only.\nNothing else was refused.`,
    });
    assert.equal(repairs.chosen, undefined);
  });
});
