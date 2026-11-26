import type { JudgedItem } from "../designer/duplicate-judge.ts";
import { promptOf, type PromptTemplate, type PromptValues } from "../common/prompt-template.ts";

/** Name of the tool the reviewer of a plan reports the duplicates with. */
export const REPORT_TOOL = "report_duplicates";

/** The prompt of the agent that reviews the scenarios of a test plan for duplicates, with the tool it reports with. */
export const PLAN_REVIEWER_PROMPT = {
  template: `You review the scenarios of one test plan, written by another agent, for duplicates. You write no scenario and no test.

Two scenarios are duplicates when the test of one would catch no defect the test of the other does not: they verify the same behaviour with the same outcome, even under other words, or with other values of the same kind.
They are not duplicates when they verify different rules, different information, or different outcomes, such as a search that finds and a search that finds nothing. Two ways to do the same thing are different rules: a search by first name and a search by last name, by a part of a name and by a whole one, each has a test of its own, whatever they find.
When in doubt, they are not duplicates: a scenario set aside is a test not written.

A scenario kept that is named by the path of a file is a test the repository already has: a candidate that verifies what it does is a duplicate of it.

Compare each candidate with the scenarios kept and with the candidates before it. Call {{report_tool}} once: each candidate that is a duplicate, with the scenario before it that already verifies it and why, in one sentence; an empty list when there is none. Then answer with one word.`,
  variables: ["report_tool"],
} as const satisfies PromptTemplate;

/** What each variable of the prompt of the reviewer of a plan stands for. */
export const PLAN_REVIEWER_VALUES: PromptValues<typeof PLAN_REVIEWER_PROMPT> = { report_tool: REPORT_TOOL };

/** System instructions of the agent that reviews the scenarios of a test plan for duplicates. */
export const PLAN_REVIEWER_INSTRUCTIONS = promptOf(PLAN_REVIEWER_PROMPT, PLAN_REVIEWER_VALUES);

/**
 * Writes the request of a review: the scenarios kept, then the candidates, each under its slug.
 *
 * @param kept - The scenarios already kept, in order.
 * @param candidates - The scenarios to judge, in order.
 * @returns The message that starts the session of the review.
 */
export function reviewRequest(kept: readonly JudgedItem[], candidates: readonly JudgedItem[]): string {
  const listed = (items: readonly JudgedItem[]) => items.map((item) => `### ${item.id}\n${item.text}`).join("\n\n");
  return [
    ...(kept.length === 0 ? [] : [`Scenarios kept:\n\n${listed(kept)}`]),
    `Candidates, in order:\n\n${listed(candidates)}`,
    `Next: call ${REPORT_TOOL} with the candidates that are duplicates, or with an empty list.`,
  ].join("\n\n");
}
