import type { DesignOutcome } from "./designer.ts";

/**
 * What two designs made one after the other gave together.
 *
 * @param before - What the designs before gave.
 * @param next - What the next one gave.
 * @param said - What the journal says once the next one is over.
 * @returns The tests and the scenarios of both, in order, the branch and the state of the last that wrote some.
 */
export function mergedOutcomes(before: DesignOutcome, next: DesignOutcome, said: DesignOutcome["journal"][number]): DesignOutcome {
  const uncovered = [...(before.uncovered ?? []), ...(next.uncovered ?? [])];
  return {
    ...before,
    ...next,
    ok: before.ok && next.ok,
    // A design that wrote nothing leaves the branch and the state of the one before as they are.
    ...(next.branch === undefined && before.branch !== undefined ? { branch: before.branch } : {}),
    ...(next.tests.length === 0 && before.statePath !== undefined ? { statePath: before.statePath, planPath: before.planPath! } : {}),
    ...(uncovered.length === 0 ? {} : { uncovered }),
    tests: [...before.tests, ...next.tests],
    planned: [...(before.planned ?? []), ...(next.planned ?? [])],
    journal: [...before.journal, ...next.journal, said],
  };
}
