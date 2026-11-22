import {
  CampaignRefusedError,
  LaunchRefusedError,
  SecretRefusedError,
  SessionEndedError,
  UnknownCampaignError,
  UnknownCaptureError,
  UnknownDocumentError,
  UnknownDocumentSourceError,
  UnknownExecutionError,
  UnknownSecretError,
  UnknownSessionError,
  UnknownTraceError,
} from "@open-qa-stack/domain";
import { DatabaseUnavailableError, PendingMigrationsError } from "@open-qa-stack/store";
import { configurationRefusal } from "./configuration-lines.ts";
import { LaunchEndError } from "./launch-end-error.ts";
import { UsageError } from "./usage-error.ts";

/** The refusals a person can act on: what they asked cannot be done as it is asked. */
const REFUSALS = [
  UsageError,
  UnknownSessionError,
  SessionEndedError,
  PendingMigrationsError,
  UnknownSecretError,
  SecretRefusedError,
  UnknownExecutionError,
  UnknownTraceError,
  UnknownCaptureError,
  LaunchRefusedError,
  UnknownCampaignError,
  CampaignRefusedError,
  UnknownDocumentError,
  UnknownDocumentSourceError,
];

/** What did not go to its end for a reason its message tells: the person reads it as it is. */
const FAILURES = [LaunchEndError];

/** Why something the command was asked did not happen, and how much the person can do about it. */
export interface Failure {
  /**
   * `refused` when what was asked cannot be done as it is asked, and the message says what to change;
   * `unavailable` when the database cannot be reached, and the message says where it is; `failed` when what was asked
   * did not go to its end, and the message says why; `unexpected` otherwise.
   */
  readonly kind: "refused" | "unavailable" | "failed" | "unexpected";
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
  const refusal = configurationRefusal(error);
  if (refusal !== undefined) return { kind: "refused", message: refusal };
  const message = error instanceof Error ? error.message : String(error);
  if (REFUSALS.some((refusal) => error instanceof refusal)) return { kind: "refused", message };
  if (FAILURES.some((failure) => error instanceof failure)) return { kind: "failed", message };
  return { kind: error instanceof DatabaseUnavailableError ? "unavailable" : "unexpected", message };
}
