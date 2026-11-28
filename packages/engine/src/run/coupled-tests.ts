import type { DesignedTest } from "@open-qa-stack/agents";
import type { TestVerdict } from "@open-qa-stack/domain";

/** A test that passed alone when it was written, and failed when the whole suite ran. */
export interface CoupledTest {
  /** Its path, relative to the root of the test repository. */
  readonly path: string;
  /** How it failed in the suite. */
  readonly reason: string;
}

/**
 * The tests of a design that passed when they were written, alone, and failed when the whole suite ran, in its
 * order: they depend on data the other tests change.
 *
 * @remarks
 * A verdict is a test's by its identifier, which holds the file of the test, as the runner names it from its
 * folder of tests, then its line: `project › file:line › titles`. A test with several failed cases gives their
 * reasons together.
 *
 * @param designed - The tests of the design.
 * @param verdicts - The verdicts of the run of the suite.
 * @returns Them, in the order of the design.
 */
export function coupledTests(designed: readonly DesignedTest[], verdicts: readonly TestVerdict[]): CoupledTest[] {
  return designed.flatMap(({ path, verdict }) => {
    if (verdict !== "passed") return [];
    const failed = verdicts.filter((test) => test.verdict === "failed" && isOf(test.id, path));
    return failed.length === 0 ? [] : [{ path, reason: failed.map((test) => test.reason).join(" ") }];
  });
}

/**
 * What a design that repairs coupled tests is asked: the brief of the agent that plans, which asks for their repair.
 *
 * @param coupled - The tests to repair.
 * @returns The brief.
 */
export function coupledBrief(coupled: readonly CoupledTest[]): string {
  return `Repair the tests ${coupled.map(({ path }) => path).join(", ")}: each passed alone when it was written, and failed when the whole suite ran, after the tests that change the data.`;
}

/** Whether the verdict of this identifier is that of the test at this path. */
function isOf(id: string, path: string): boolean {
  const file = id.split(" › ")[1]?.replace(/:\d+$/, "");
  return file !== undefined && (path === file || path.endsWith(`/${file}`));
}
