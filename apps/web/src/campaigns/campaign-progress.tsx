import type { ReactNode } from "react";
import type { CampaignCounts, TestLaunch } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { statusCount } from "../i18n/vocabulary.ts";
import { Badge, type BadgeTone } from "../ui/badge.tsx";

/** The verdicts a campaign counts, in the order its bar shows them, each with the tone of its badge. */
const PARTS: readonly (readonly [keyof CampaignCounts, BadgeTone])[] = [
  ["passed", "ok"],
  ["flaky", "warn"],
  ["skipped", "neutral"],
  ["failed", "ko"],
  ["not_run", "outline"],
];

/** How many tests of a campaign ran: all but those not run. */
export function ranOf(counts: CampaignCounts): number {
  return counts.passed + counts.failed + counts.flaky + counts.skipped;
}

/** The bar of the verdicts of a campaign: a part for each, as long as how many came to it, what was not run left empty. */
export function CampaignBar({ counts, wide = false }: { readonly counts: CampaignCounts; readonly wide?: boolean }): ReactNode {
  return (
    <span className={wide ? "campaign-bar wide" : "campaign-bar"} aria-hidden="true">
      {PARTS.map(([verdict]) => (
        <span key={verdict} className={`verdict-part ${verdict}`} style={{ flexGrow: counts[verdict] }} />
      ))}
    </span>
  );
}

/** How far the launch of the tests of a campaign that runs went. */
function LaunchLine({ launch }: { readonly launch: TestLaunch }): ReactNode {
  const finished = launch.progress?.finished.length ?? 0;
  const total = launch.progress?.total;
  return (
    <div className="campaign-launch small" role="status">
      <span className="campaign-spinner" aria-hidden="true" />
      {total === undefined ? t("campaign.launchPreparing") : t("campaign.launchProgress", { finished, total })}
      {total !== undefined && (
        <progress className="campaign-launch-bar" max={total} value={finished}>
          {finished} / {total}
        </progress>
      )}
    </div>
  );
}

/** How far a campaign went: how many of its tests ran, the bar of their verdicts, a badge each, and the launch that runs. */
export function CampaignProgressCard({ counts, launch }: { readonly counts: CampaignCounts; readonly launch?: TestLaunch }): ReactNode {
  const total = ranOf(counts) + counts.not_run;
  return (
    <section className="card campaign-progress" aria-label={t("campaign.progress")}>
      <div className="campaign-progress-head">
        <span className="small muted">{t("campaign.progress")}</span>
        <b>{t("campaign.ran", { ran: ranOf(counts), total })}</b>
      </div>
      <CampaignBar counts={counts} wide />
      <div className="campaign-progress-counts">
        {PARTS.filter(([verdict]) => counts[verdict] > 0).map(([verdict, tone]) => (
          <Badge key={verdict} tone={tone}>
            {statusCount(verdict, counts[verdict])}
          </Badge>
        ))}
      </div>
      {launch !== undefined && <LaunchLine launch={launch} />}
    </section>
  );
}
