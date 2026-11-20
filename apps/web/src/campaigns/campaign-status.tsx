import type { ReactNode } from "react";
import type { CampaignStatus } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { Badge, type BadgeTone } from "../ui/badge.tsx";

/** The tone of each state of a campaign: what is still prepared, what runs, what is over. */
const TONES: Readonly<Record<CampaignStatus, BadgeTone>> = { planned: "outline", ready: "info", in_progress: "ai", closed: "neutral" };

/** Where a campaign is in its life, as a badge. */
export function CampaignStatusBadge({ status }: { readonly status: CampaignStatus }): ReactNode {
  return <Badge tone={TONES[status]}>{t(`campaigns.statuses.${status}`)}</Badge>;
}
