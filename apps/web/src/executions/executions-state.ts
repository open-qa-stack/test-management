import type { Execution } from "@open-qa-stack/domain/sessions";

/** What the screen of the executions holds: what the instance told of the executions of tests it keeps. */
export interface ExecutionsState {
  /** The executions, the latest first, once the instance listed them. */
  readonly executions?: readonly Execution[];
  /** Why the instance could not list them, when it answered so. */
  readonly unread?: string;
}

/** What changes the state of the screen. */
export type ExecutionsAction =
  /** The instance listed the executions. */
  | { readonly type: "listed"; readonly executions: readonly Execution[] }
  /** The instance could not list them. */
  | { readonly type: "unread"; readonly message: string };

/** The state of the screen before the instance told anything. */
export const INITIAL_EXECUTIONS: ExecutionsState = {};

/**
 * Gives the state of the screen after an action: the executions listed last stay shown while the instance does not answer.
 *
 * @param state - The state before.
 * @param action - What happened.
 * @returns The state after.
 */
export function executionsAfter(state: ExecutionsState, action: ExecutionsAction): ExecutionsState {
  if (action.type === "listed") return { executions: action.executions };
  return { ...state, unread: action.message };
}
