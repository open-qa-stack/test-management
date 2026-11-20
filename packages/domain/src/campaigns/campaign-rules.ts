import { byCodeUnits } from "../text-order.ts";
import { CampaignRefusedError } from "./campaign-refused-error.ts";
import type { CampaignCounts, CampaignResult, CampaignScope, CampaignStatus, CampaignTest } from "./campaign.ts";
import type { Execution } from "../executions/execution.ts";

/** The one change each state of a campaign takes. */
const NEXT: Readonly<Record<CampaignStatus, CampaignStatus | undefined>> = {
  planned: "ready",
  ready: "in_progress",
  in_progress: "closed",
  closed: undefined,
};

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

/**
 * The tests of the repository a scope takes: those that bear at least one of its tags, every test when it names
 * none, in the order of their paths then their titles.
 *
 * @param scope - The scope of a campaign.
 * @param tests - The tests of the repository, each with its tags.
 */
export function scopedTests(scope: CampaignScope, tests: readonly (CampaignTest & { readonly tags: readonly string[] })[]): CampaignTest[] {
  const taken = scope.tags.length === 0 ? tests : tests.filter((test) => test.tags.some((tag) => scope.tags.includes(tag)));
  return taken.map(({ path, title }) => ({ path, title })).sort((a, b) => byCodeUnits(a.path, b.path) || byCodeUnits(a.title, b.title));
}

/** @returns How many of the results came to each verdict, and how many were not run. */
export function campaignCounts(results: readonly CampaignResult[]): CampaignCounts {
  const count = (verdict: CampaignResult["verdict"]): number => results.filter((result) => result.verdict === verdict).length;
  return { passed: count("passed"), failed: count("failed"), flaky: count("flaky"), skipped: count("skipped"), not_run: count("not_run") };
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
