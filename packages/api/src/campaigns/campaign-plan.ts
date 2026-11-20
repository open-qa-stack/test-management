import { requestBody } from "../sessions/request-body.ts";
import { SessionError } from "../sessions/session-error.ts";
import type { CampaignPlan } from "@open-qa-stack/domain/sessions";

/** The fields a client may send. */
const FIELDS = ["name", "environment", "tags"] as const;

/** Longest name of a campaign, in characters. */
export const MAX_CAMPAIGN_NAME_LENGTH = 200;

/** Most tags the scope of a campaign names. */
export const MAX_CAMPAIGN_TAGS = 50;

/** A tag as Playwright writes it: `@` then no space. */
const TAG = /^@\S{1,99}$/;

/** Whether a value is a text that holds more than spaces and that a command line cannot take for one of its options. */
function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !value.startsWith("--");
}

/**
 * Reads the body of a request to plan a campaign.
 *
 * @param body - The body, as the client sent it.
 * @returns The plan: its name, its environment, and the tags of its scope, none for every test.
 * @throws {@link SessionError} `invalid_request` naming the field at fault: a body that is no JSON object, a field that
 * is none of a plan, `name` that is not a text of at most {@link MAX_CAMPAIGN_NAME_LENGTH} characters, `environment` that
 * is not a text, `tags` that is given and is not a list of at most {@link MAX_CAMPAIGN_TAGS} tags, each `@` then no space.
 */
export function campaignPlanOf(body: unknown): CampaignPlan {
  const { name, environment, tags = [] } = requestBody(body, FIELDS, "a plan of a campaign");
  if (!isText(name) || name.length > MAX_CAMPAIGN_NAME_LENGTH)
    throw new SessionError(
      "invalid_request",
      `name must be a text that is not empty, does not start with -- and is at most ${MAX_CAMPAIGN_NAME_LENGTH} characters long.`,
    );
  if (!isText(environment)) throw new SessionError("invalid_request", "environment must be a text that is not empty and does not start with --.");
  if (!Array.isArray(tags) || tags.length > MAX_CAMPAIGN_TAGS || !tags.every((tag) => typeof tag === "string" && TAG.test(tag)))
    throw new SessionError(
      "invalid_request",
      `tags must be a list of at most ${MAX_CAMPAIGN_TAGS} tags, each @ then no space, such as @p0; leave it out to take every test.`,
    );
  return { name: name.trim(), environment, scope: { tags: [...new Set(tags as string[])] } };
}
