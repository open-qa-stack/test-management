/** What a screen holds of what it asks the instance again and again: the latest answer, and why the instance could not answer. */
export interface PolledState<T> {
  /** The latest answer, once the instance gave one. */
  readonly value?: T;
  /** Why the instance could not answer, when it answered so. */
  readonly unread?: string;
}

/** What changes that state. */
export type PolledAction<T> =
  /** The instance answered. */
  | { readonly type: "read"; readonly value: T }
  /** The instance could not answer. */
  | { readonly type: "unread"; readonly message: string };

/**
 * Gives the state after an action: the latest answer stays shown while the instance does not answer.
 *
 * @param state - The state before.
 * @param action - What happened.
 * @returns The state after.
 */
export function polledAfter<T>(state: PolledState<T>, action: PolledAction<T>): PolledState<T> {
  if (action.type === "read") return { value: action.value };
  return { ...state, unread: action.message };
}
