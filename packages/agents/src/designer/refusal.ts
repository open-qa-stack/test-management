import type { Journal } from "../common/journal.ts";

/** One reason a gate of the harness refuses a call. */
export interface Refusal {
  /** The code of the gate, such as `PLAN-ID`, by which a trial is scored. */
  readonly code: string;
  /** What is wrong and what to do, in sentences the agent can act on. */
  readonly message: string;
}

/**
 * What the agent is told of a refusal: every reason, one line each, with its code, then a line that says
 * nothing else was refused, so that it fixes all of them at once.
 *
 * @param refusals - The reasons, at least one.
 * @returns The text of the refusal.
 */
export function refusalText(refusals: readonly Refusal[]): string {
  return [...refusals.map(({ code, message }) => `Refused (${code}): ${message}`), "Nothing else was refused."].join("\n");
}

/**
 * Journals each reason of a refusal, with its code first.
 *
 * @param journal - The journal.
 * @param what - What was refused, such as `The plan was refused by the harness`.
 * @param refusals - The reasons.
 */
export function journalRefusals(journal: Journal, what: string, refusals: readonly Refusal[]): void {
  for (const { code, message } of refusals) journal.record("error", `[${code}] ${what}: ${message}`);
}
