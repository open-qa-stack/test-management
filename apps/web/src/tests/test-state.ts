import type { TestReading } from "@open-qa-stack/domain/sessions";

/** What the screen of a test holds: what the instance told of the test in steps. */
export interface TestState {
  /** The test in steps, once the instance read it. */
  readonly reading?: TestReading;
  /** Why the instance could not read it, when it answered so. */
  readonly unread?: string;
}

/** What changes the state of the screen. */
export type TestAction =
  /** The instance read the test. */
  | { readonly type: "read"; readonly reading: TestReading }
  /** The instance could not read it. */
  | { readonly type: "unread"; readonly message: string };

/** The state of the screen before the instance told anything. */
export const INITIAL_TEST: TestState = {};

/**
 * Gives the state of the screen after an action: the test read last stays shown while the instance does not answer.
 *
 * @param state - The state before.
 * @param action - What happened.
 * @returns The state after.
 */
export function testAfter(state: TestState, action: TestAction): TestState {
  if (action.type === "read") return { reading: action.reading };
  return { ...state, unread: action.message };
}
