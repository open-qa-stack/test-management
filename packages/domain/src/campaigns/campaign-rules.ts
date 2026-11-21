import { byCodeUnits } from "../text-order.ts";
import { CampaignRefusedError } from "./campaign-refused-error.ts";
import type { CampaignCounts, CampaignResult, CampaignStatus, CampaignTest, CampaignVerdict } from "./campaign.ts";
import type { Execution } from "../executions/execution.ts";

/** The one change each state of a campaign takes. */
const NEXT: Readonly<Record<CampaignStatus, CampaignStatus | undefined>> = {
  planned: "ready",
  ready: "in_progress",
  in_progress: "closed",
  closed: undefined,
};

/**
 * Puts the tests chosen for a campaign in order: by their paths then their titles, each once.
 *
 * @param tests - The tests chosen, in any order.
 */
export function chosenTests(tests: readonly CampaignTest[]): CampaignTest[] {
  const unique = new Map(tests.map(({ path, title }) => [`${path}\n${title}`, { path, title }]));
  return [...unique.values()].sort((a, b) => byCodeUnits(a.path, b.path) || byCodeUnits(a.title, b.title));
}

/**
 * Checks that a campaign may go from one state to another: from planned to ready, then in_progress, then closed,
 * which is final.
 *
 * @throws {@link CampaignRefusedError} for any other change, naming both states.
 */
export function campaignTransition(from: CampaignStatus, to: CampaignStatus): void {
  if (NEXT[from] !== to)
    throw new CampaignRefusedError(`A campaign ${from} cannot become ${to}: a campaign goes from planned to ready, then in_progress, then closed.`);
}

/** @returns How many of the results came to each verdict, and how many were not run. */
export function campaignCounts(results: readonly CampaignResult[]): CampaignCounts {
  const count = (verdict: CampaignResult["verdict"]): number => results.filter((result) => result.verdict === verdict).length;
  return { passed: count("passed"), failed: count("failed"), flaky: count("flaky"), skipped: count("skipped"), not_run: count("not_run") };
}

/**
 * Whether a campaign passes, as the maintainer decided it: with no criterion of its own, it passes when every test it is
 * made of passed in its latest execution — at once, or on a retry, as a flaky test does — and does not pass as soon as
 * one failed, was skipped, or was not run.
 *
 * @param counts - How many of its tests came to each verdict.
 * @returns Its verdict; `undefined` for a campaign of no test.
 */
export function campaignVerdict(counts: CampaignCounts): CampaignVerdict | undefined {
  const total = counts.passed + counts.flaky + counts.failed + counts.skipped + counts.not_run;
  if (total === 0) return undefined;
  return counts.failed + counts.skipped + counts.not_run === 0 ? "passes" : "fails";
}

/**
 * What came of each test of a campaign: its verdict in the latest of the executions that ran its file, `not_run`
 * for one none ran.
 *
 * @remarks
 * A test is found in an execution by the path of its file: a launch runs files, and the tests of the repository are
 * listed one per file.
 *
 * @param tests - The tests the campaign fixed.
 * @param executions - The executions of the campaign, in any order.
 */
export function campaignResults(tests: readonly CampaignTest[], executions: readonly Execution[]): CampaignResult[] {
  const latestFirst = executions.toSorted((a, b) => byCodeUnits(b.ranAt, a.ranAt));
  return tests.map((test) => {
    for (const execution of latestFirst) {
      const result = execution.results.find(({ path }) => path === test.path);
      if (result !== undefined) return { ...test, verdict: result.verdict, execution: execution.id, ranAt: execution.ranAt };
    }
    return { ...test, verdict: "not_run" };
  });
}
