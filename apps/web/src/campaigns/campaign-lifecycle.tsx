import type { ReactNode } from "react";
import type { CampaignStatus } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";

/** The states of a campaign, in the order of its life. */
const STATES: readonly CampaignStatus[] = ["planned", "ready", "in_progress", "closed"];

/** The life of a campaign as steps: those it went through, the one it is at, those to come. */
export function CampaignLifecycle({ status }: { readonly status: CampaignStatus }): ReactNode {
  const at = STATES.indexOf(status);
  return (
    <ol className="campaign-lifecycle small" aria-label={t("campaign.lifecycle")}>
      {STATES.map((state, rank) => (
        <li key={state} className={rank < at ? "done" : rank === at ? "current" : undefined} {...(rank === at ? { "aria-current": "step" as const } : {})}>
          {t(`campaigns.statuses.${state}`)}
        </li>
      ))}
    </ol>
  );
}
