import { requestBody } from "../sessions/request-body.ts";
import { SessionError } from "../sessions/session-error.ts";
import type { CampaignTest } from "@open-qa-stack/domain/sessions";

/** Most tests a campaign is made of. */
export const MAX_CAMPAIGN_TESTS = 2000;

/** Whether a value names a test as the repository lists it: the path of its file and its title, both texts. */
function isTest(value: unknown): value is CampaignTest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { path, title, ...rest } = value as Record<string, unknown>;
  return typeof path === "string" && path !== "" && typeof title === "string" && title !== "" && Object.keys(rest).length === 0;
}

/**
 * Reads the body of a choice of the tests of a campaign.
 *
 * @param body - The body, as the client sent it.
 * @returns The tests chosen, none to leave the campaign without one.
 * @throws {@link SessionError} `invalid_request` naming the field at fault: a body that is no JSON object, a field that
 * is not `tests`, `tests` that is not a list of at most {@link MAX_CAMPAIGN_TESTS} tests, each a `path` and a `title`.
 */
export function campaignTestsOf(body: unknown): readonly CampaignTest[] {
  const { tests } = requestBody(body, ["tests"], "a choice of the tests of a campaign");
  if (!Array.isArray(tests) || tests.length > MAX_CAMPAIGN_TESTS || !tests.every(isTest))
    throw new SessionError(
      "invalid_request",
      `tests must be a list of at most ${MAX_CAMPAIGN_TESTS} tests, each a path and a title as the repository lists them.`,
    );
  return tests.map(({ path, title }) => ({ path, title }));
}
