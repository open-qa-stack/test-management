import type { Campaign, CampaignCounts, CampaignOverview, CampaignProgress } from "@open-qa-stack/domain";

/** How a campaign stands, in the words of the command. */
const STATUSES: Readonly<Record<Campaign["status"], string>> = { planned: "planned", ready: "ready", in_progress: "in progress", closed: "closed" };

/** The verdicts a campaign counts, in the order a person reads them, with their words. */
const COUNTED: readonly (readonly [keyof CampaignCounts, string])[] = [
  ["passed", "passed"],
  ["flaky", "passed on a retry"],
  ["failed", "failed"],
  ["skipped", "skipped"],
  ["not_run", "not run"],
];

/**
 * @param campaign - A campaign.
 * @returns The line that names it, how it stands, its environment and how many tests it is made of.
 */
export function campaignLine(campaign: Campaign): string {
  const tests = campaign.tests.length === 1 ? "1 test" : `${campaign.tests.length} tests`;
  return `${campaign.id}  ${campaign.name}  ${STATUSES[campaign.status]}  ${campaign.environment}  ${tests}`;
}

/** What was said of a campaign, a line each, in the words of the command. */
function detailLines({ objective, targetVersion, startsOn, endsOn, owner }: Campaign): string[] {
  const said = { objective, version: targetVersion, from: startsOn, until: endsOn, owner };
  return Object.entries(said).flatMap(([name, value]) => (value === undefined ? [] : [`${name}: ${value}`]));
}

/**
 * @param overview - A campaign with how many of its tests came to each verdict.
 * @returns Its line, followed by the verdicts some of its tests came to.
 */
export function overviewLine(overview: CampaignOverview): string {
  const counted = COUNTED.filter(([verdict]) => overview.counts[verdict] > 0).map(([verdict, words]) => `${overview.counts[verdict]} ${words}`);
  return `${campaignLine(overview)}${counted.length === 0 ? "" : `: ${counted.join(", ")}`}`;
}

/**
 * @param progress - A campaign with what came of each of its tests.
 * @returns Its line, what was said of it, then a line per test with its verdict and the execution that gave it.
 */
export function progressLines({ campaign, results }: CampaignProgress): string[] {
  return [
    campaignLine(campaign),
    ...detailLines(campaign),
    ...results.map(
      ({ verdict, path, title, execution }) =>
        `${(verdict === "not_run" ? "not run" : verdict).padEnd(7)} ${path} › ${title}${execution === undefined ? "" : `, execution ${execution}`}`,
    ),
  ];
}
