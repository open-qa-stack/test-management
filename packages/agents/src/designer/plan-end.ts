import type { PlanEnd } from "@open-qa-stack/domain";

/**
 * Why the harness asked an agent for no more scenarios, in a sentence, as the journal, the agent and the
 * file of the plan give it.
 *
 * @param end - The reason.
 * @param maximum - Most scenarios a plan holds.
 * @returns The sentence, which starts in lower case and ends with a full stop.
 */
export function planEndText(end: PlanEnd, maximum: number): string {
  if (end === "covered") return "the agent said the brief is covered.";
  if (end === "exhausted") return "the scenarios last submitted were duplicates, and the agent has nothing new to verify.";
  if (end === "maximum") return `the plan holds ${maximum} scenarios, the most a plan may.`;
  return "the agent ended its session without another scenario.";
}
