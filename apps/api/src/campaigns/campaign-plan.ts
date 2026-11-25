import { requestBody } from "../sessions/request-body.ts";
import { SessionError } from "../sessions/session-error.ts";
import { CAMPAIGN_DETAILS } from "@open-qa-stack/domain";
import type { CampaignDetails, CampaignPlan } from "@open-qa-stack/domain/sessions";

/** The fields a client may send. */
const FIELDS = ["name", "environment", ...CAMPAIGN_DETAILS] as const;

/** Longest name of a campaign, in characters. */
export const MAX_CAMPAIGN_NAME_LENGTH = 200;

/** Longest detail of a campaign, in characters. */
export const MAX_CAMPAIGN_DETAIL_LENGTH = 500;

/** Whether a value is a text that holds more than spaces and that a command line cannot take for one of its options. */
function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !value.startsWith("--");
}

/** The details a body gives of a campaign, spaces around them left out. */
function detailsOf(given: Readonly<Record<string, unknown>>): CampaignDetails {
  return Object.fromEntries(
    Object.entries(given).map(([name, value]) => {
      if (!isText(value) || value.length > MAX_CAMPAIGN_DETAIL_LENGTH)
        throw new SessionError(
          "invalid_request",
          `${name} must be a text that is not empty, does not start with -- and is at most ${MAX_CAMPAIGN_DETAIL_LENGTH} characters long, or be left out.`,
        );
      return [name, value.trim()];
    }),
  );
}

/**
 * Reads the body of a request to plan a campaign.
 *
 * @param body - The body, as the client sent it.
 * @returns The plan: its name, its environment, and what a person says of it.
 * @throws {@link SessionError} `invalid_request` naming the field at fault: a body that is no JSON object, a field that
 * is none of a plan, `name` that is not a text of at most {@link MAX_CAMPAIGN_NAME_LENGTH} characters, `environment` that
 * is not a text, a detail that is not a text of at most {@link MAX_CAMPAIGN_DETAIL_LENGTH} characters.
 */
export function campaignPlanOf(body: unknown): CampaignPlan {
  const { name, environment, ...details } = requestBody(body, FIELDS, "a plan of a campaign");
  if (!isText(name) || name.length > MAX_CAMPAIGN_NAME_LENGTH)
    throw new SessionError(
      "invalid_request",
      `name must be a text that is not empty, does not start with -- and is at most ${MAX_CAMPAIGN_NAME_LENGTH} characters long.`,
    );
  if (!isText(environment)) throw new SessionError("invalid_request", "environment must be a text that is not empty and does not start with --.");
  return { name: name.trim(), environment, ...detailsOf(details) };
}
