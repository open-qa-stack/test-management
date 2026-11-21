import type { ReactNode } from "react";
import { campaignVerdict, type CampaignCounts } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { Badge } from "../ui/badge.tsx";

/** Whether a campaign passes, as a badge: every test passed, at once or on a retry, or not; nothing for a campaign of no test. */
export function CampaignVerdictBadge({ counts }: { readonly counts: CampaignCounts }): ReactNode {
  const verdict = campaignVerdict(counts);
  if (verdict === undefined) return undefined;
  return <Badge tone={verdict === "passes" ? "ok" : "ko"}>{t(`campaign.verdicts.${verdict}`)}</Badge>;
}
