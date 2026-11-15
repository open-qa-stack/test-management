import type { PlanEnd } from "@open-qa-stack/domain";

/**
 * Why the harness asked an agent for no more scenarios, in a sentence, as the journal, the agent and the
 * file of the plan give it.
 *
 * @param end - The reason.
 * @returns The sentence, which starts in lower case and ends with a full stop.
 */
export function planEndText(end: PlanEnd): string {
  if (end === "covered") return "the agent said the brief is covered.";
  if (end === "none") return "the agent said no test can do what the brief asks.";
  if (end === "exhausted") return "the scenarios last submitted were duplicates, and the agent has nothing new to verify.";
  return "the agent ended its session without another scenario.";
}
