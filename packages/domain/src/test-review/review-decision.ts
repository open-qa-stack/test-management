import { isRecord } from "../json.ts";
import type { Session } from "../sessions/session.ts";
import { SET_ASIDE_REASONS, type SetAsideReason, type TestDecision } from "./test-review.ts";

/** The longest note a person adds to a test they set aside, in characters. */
export const MAX_SET_ASIDE_NOTE = 500;

/** What a person decides of a test the agents wrote: to validate it, or to set it aside, with why. */
export type ReviewDecision =
  | { readonly status: "validated" }
  | {
      readonly status: "set_aside";
      readonly reason: SetAsideReason;
      /** For `covered`, the path of the test that already verifies it. */
      readonly coveredBy?: string;
      /** What the person adds, in their words. */
      readonly note?: string;
    };

/** What came of a decision: the decision kept, and for a test validated, the working branch it entered. */
export interface DecidedTest {
  readonly decision: TestDecision;
  /** For a test validated, the working branch of the test repository it entered, and whether a commit took it there: none when the branch had it already as the design wrote it. */
  readonly entered?: { readonly branch: string; readonly committed: boolean };
}

/** A text that is no empty string once trimmed, as the given one trimmed. */
function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * Reads what a person decides of a test, as a client sends it.
 *
 * @param value - The body: `{ status: "validated" }`, or `{ status: "set_aside", reason, coveredBy?, note? }`.
 * @returns The decision; or why it is refused, in a sentence: a status or a reason that is none of those known, a test
 * set aside as covered without the test that covers it, or a note too long.
 */
export function reviewDecisionOf(value: unknown): ReviewDecision | string {
  if (!isRecord(value)) return 'A decision is { "status": "validated" } or { "status": "set_aside", "reason" }.';
  if (value["status"] === "validated") return { status: "validated" };
  if (value["status"] !== "set_aside") return 'The status of a decision is "validated" or "set_aside".';
  const reason = SET_ASIDE_REASONS.find((known) => known === value["reason"]);
  if (reason === undefined) return `The reason a test is set aside is one of ${SET_ASIDE_REASONS.join(", ")}.`;
  const coveredBy = textOf(value["coveredBy"]);
  if (reason === "covered" && coveredBy === undefined) return "A test set aside as covered names the test that covers it, in coveredBy.";
  const note = textOf(value["note"]);
  if (note !== undefined && note.length > MAX_SET_ASIDE_NOTE) return `The note of a test set aside is ${MAX_SET_ASIDE_NOTE} characters at most.`;
  return { status: "set_aside", reason, ...(reason === "covered" ? { coveredBy: coveredBy! } : {}), ...(note === undefined ? {} : { note }) };
}

/** The longest instruction a person gives to correct a test, in characters. */
export const MAX_CORRECTION = 2000;

/** What a person asks the agents to change in a test to review. */
export interface ReviewCorrection {
  /** What to change, in their words. */
  readonly instruction: string;
}

/** What came of a correction asked: the decision kept, and the session that corrects the test, resumed. */
export interface CorrectedTest {
  readonly decision: Extract<TestDecision, { status: "in_correction" }>;
  readonly session: Session;
}

/**
 * Reads what a person asks the agents to change in a test, as a client sends it.
 *
 * @param value - The body: `{ instruction }`.
 * @returns The correction, its instruction trimmed; or why it is refused, in a sentence: no instruction, or one too long.
 */
export function reviewCorrectionOf(value: unknown): ReviewCorrection | string {
  const instruction = isRecord(value) ? textOf(value["instruction"]) : undefined;
  if (instruction === undefined || instruction.length > MAX_CORRECTION)
    return `A correction is { "instruction" }: what to change in the test, 1 to ${MAX_CORRECTION} characters.`;
  return { instruction };
}
