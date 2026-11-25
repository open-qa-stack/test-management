import type { Campaign, CampaignDetails } from "@open-qa-stack/domain/sessions";
import { calendarText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";

/** The environment of a campaign, with the version it tests when one was said. */
export function campaignEnvironment({ environment, targetVersion }: Pick<Campaign, "environment" | "targetVersion">): string {
  return [environment, targetVersion].filter((part) => part !== undefined).join(" · ");
}

/** The days a campaign is meant to run, in a few words; `undefined` when none was said. */
export function campaignDays({ startsOn, endsOn }: CampaignDetails): string | undefined {
  if (startsOn !== undefined && endsOn !== undefined) return t("campaigns.days.both", { from: calendarText(startsOn), until: calendarText(endsOn) });
  if (startsOn !== undefined) return t("campaigns.days.from", { from: calendarText(startsOn) });
  return endsOn === undefined ? undefined : t("campaigns.days.until", { until: calendarText(endsOn) });
}
