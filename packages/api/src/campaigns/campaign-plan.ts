import { requestBody } from "../sessions/request-body.ts";
import { SessionError } from "../sessions/session-error.ts";
import type { CampaignPlan } from "@open-qa-stack/domain/sessions";

/** The fields a client may send. */
const FIELDS = ["name", "environment"] as const;

/** Longest name of a campaign, in characters. */
export const MAX_CAMPAIGN_NAME_LENGTH = 200;

/** Whether a value is a text that holds more than spaces and that a command line cannot take for one of its options. */
function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !value.startsWith("--");
}

/**
 * Reads the body of a request to plan a campaign.
 *
 * @param body - The body, as the client sent it.
 * @returns The plan: its name and its environment.
 * @throws {@link SessionError} `invalid_request` naming the field at fault: a body that is no JSON object, a field that
 * is none of a plan, `name` that is not a text of at most {@link MAX_CAMPAIGN_NAME_LENGTH} characters, `environment` that
 * is not a text.
 */
export function campaignPlanOf(body: unknown): CampaignPlan {
  const { name, environment } = requestBody(body, FIELDS, "a plan of a campaign");
  if (!isText(name) || name.length > MAX_CAMPAIGN_NAME_LENGTH)
    throw new SessionError(
      "invalid_request",
      `name must be a text that is not empty, does not start with -- and is at most ${MAX_CAMPAIGN_NAME_LENGTH} characters long.`,
    );
  if (!isText(environment)) throw new SessionError("invalid_request", "environment must be a text that is not empty and does not start with --.");
  return { name: name.trim(), environment };
}
