import type { TerminalEvent, Verdict } from "@open-qa-stack/domain";

/**
 * Pronounces the verdict of an agent turn, whatever the model says about it.
 *
 * @remarks
 * A turn stopped by a limit or broken by an error is `indeterminate`. A turn that ended normally has run
 * no test by itself: it is `not_run` until a test run gives its own verdict.
 *
 * @param last - The event that ended the turn.
 * @returns The verdict; never `passed`.
 */
export function turnVerdict(last: TerminalEvent): Verdict {
  return last.type === "end" ? "not_run" : "indeterminate";
}
