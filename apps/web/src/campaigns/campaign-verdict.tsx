import type { ReactNode } from "react";
import { campaignVerdict, type CampaignCounts } from "@open-qa-stack/domain/sessions";
import { statusName } from "../i18n/vocabulary.ts";
import { Badge } from "../ui/badge.tsx";

/** Whether a campaign passes, as a badge: every test passed, at once or on a retry, or not; nothing for a campaign of no test. */
export function CampaignVerdictBadge({ counts }: { readonly counts: CampaignCounts }): ReactNode {
  const verdict = campaignVerdict(counts);
  if (verdict === undefined) return undefined;
  return <Badge tone={verdict === "passes" ? "ok" : "ko"}>{statusName(verdict === "passes" ? "passed" : "failed")}</Badge>;
}
