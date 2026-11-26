import { SET_ASIDE_CLASSES, type DesignedTest } from "@open-qa-stack/agents";

/** The designed tests the execution runs, and those it leaves out. */
export interface RunnableTests {
  /** Paths of the tests to run, in the order of the design. */
  readonly run: readonly string[];
  /** Paths of the tests left out: those classed `unfinished`, `duplicate` or `unfeasible`. */
  readonly leftOut: readonly string[];
}

/**
 * Sorts the designed tests into those the execution runs and those it leaves out.
 *
 * @remarks
 * A test stands as its last class says. A test classed `duplicate` runs what another test of the design runs,
 * and is kept without being run again. A test classed `unfinished` is kept in the test repository and in the
 * state of its design for a person to decide, and is not run: its file may be a skeleton.
 *
 * @param tests - The tests of a design.
 * @returns The paths to run, and those left out.
 */
export function runnableTests(tests: readonly DesignedTest[]): RunnableTests {
  const leftOut = (test: DesignedTest): boolean => SET_ASIDE_CLASSES.includes(test.classes.at(-1)!.class);
  return {
    run: tests.filter((test) => !leftOut(test)).map((test) => test.path),
    leftOut: tests.filter(leftOut).map((test) => test.path),
  };
}
