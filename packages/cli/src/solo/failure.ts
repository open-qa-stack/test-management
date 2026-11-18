import { SessionEndedError, UnknownSessionError } from "@open-qa-stack/domain";
import { DatabaseUnavailableError, PendingMigrationsError } from "@open-qa-stack/store";
import { UsageError } from "./usage-error.ts";

/** The refusals a person can act on: what they asked cannot be done as it is asked. */
const REFUSALS = [UsageError, UnknownSessionError, SessionEndedError, PendingMigrationsError];

/** Why something the command was asked did not happen, and how much the person can do about it. */
export interface Failure {
  /**
   * `refused` when what was asked cannot be done as it is asked, and the message says what to change;
   * `unavailable` when the database cannot be reached, and the message says where it is; `unexpected` otherwise.
   */
  readonly kind: "refused" | "unavailable" | "unexpected";
  /** What went wrong, in a sentence; never a stack trace. */
  readonly message: string;
}

/**
 * Reads what a command or an operation on sessions raised, for whoever tells it to a person.
 *
 * @param error - What was raised.
 * @returns Its kind and its message.
 */
export function failureOf(error: unknown): Failure {
  const message = error instanceof Error ? error.message : String(error);
  if (REFUSALS.some((refusal) => error instanceof refusal)) return { kind: "refused", message };
  return { kind: error instanceof DatabaseUnavailableError ? "unavailable" : "unexpected", message };
}
