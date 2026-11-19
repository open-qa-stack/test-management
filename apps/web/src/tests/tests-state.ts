import type { RepositoryTest } from "@open-qa-stack/domain/sessions";

/** What the screen of the tests holds: what the instance told of the tests of the repository. */
export interface TestsState {
  /** The tests of the repository, once the instance listed them. */
  readonly tests?: readonly RepositoryTest[];
  /** Why the instance could not list them, when it answered so. */
  readonly unread?: string;
}

/** What changes the state of the screen. */
export type TestsAction =
  /** The instance listed the tests of the repository. */
  | { readonly type: "listed"; readonly tests: readonly RepositoryTest[] }
  /** The instance could not list them. */
  | { readonly type: "unread"; readonly message: string };

/** The state of the screen before the instance told anything. */
export const INITIAL_TESTS: TestsState = {};

/**
 * Gives the state of the screen after an action: the tests listed last stay shown while the instance does not answer.
 *
 * @param state - The state before.
 * @param action - What happened.
 * @returns The state after.
 */
export function testsAfter(state: TestsState, action: TestsAction): TestsState {
  if (action.type === "listed") return { tests: action.tests };
  return { ...state, unread: action.message };
}
