import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CampaignRefusedError, UnknownCampaignError } from "@open-qa-stack/domain";
import { campaignPlanOf, MAX_CAMPAIGN_NAME_LENGTH, MAX_CAMPAIGN_TAGS } from "../src/campaigns/campaign-plan.ts";
import { CampaignLaunchPipe } from "../src/campaigns/campaign-launch.pipe.ts";
import { CampaignPlanPipe } from "../src/campaigns/campaign-plan.pipe.ts";
import { expectedProblem } from "../src/problems/expected-problem.ts";
import { SessionError } from "../src/sessions/session-error.ts";

/** What a reading raised, which must be a refusal of the request. */
function refusalOf(action: () => unknown): SessionError {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof SessionError);
    return error;
  }
  assert.fail("The reading was not refused.");
}

describe("a plan of a campaign", () => {
  it("names the campaign, its environment, and the tags of its scope once each, none for every test", () => {
    assert.deepEqual(campaignPlanOf({ name: " Recette ", environment: "local" }), { name: "Recette", environment: "local", scope: { tags: [] } });
    assert.deepEqual(campaignPlanOf({ name: "R", environment: "local", tags: ["@p0", "@p1", "@p0"] }).scope, { tags: ["@p0", "@p1"] });
    assert.equal(campaignPlanOf({ name: "x".repeat(MAX_CAMPAIGN_NAME_LENGTH), environment: "local" }).name.length, MAX_CAMPAIGN_NAME_LENGTH);
  });

  const NAME = `name must be a text that is not empty, does not start with -- and is at most ${MAX_CAMPAIGN_NAME_LENGTH} characters long.`;
  const ENVIRONMENT = "environment must be a text that is not empty and does not start with --.";
  const TAGS = `tags must be a list of at most ${MAX_CAMPAIGN_TAGS} tags, each @ then no space, such as @p0; leave it out to take every test.`;
  for (const [body, message] of [
    [[], "The body must be a JSON object."],
    [{ environment: "local" }, NAME],
    [{ name: " ", environment: "local" }, NAME],
    [{ name: "--x", environment: "local" }, NAME],
    [{ name: "x".repeat(MAX_CAMPAIGN_NAME_LENGTH + 1), environment: "local" }, NAME],
    [{ name: "R" }, ENVIRONMENT],
    [{ name: "R", environment: "--x" }, ENVIRONMENT],
    [{ name: "R", environment: "local", tags: "@p0" }, TAGS],
    [{ name: "R", environment: "local", tags: ["p0"] }, TAGS],
    [{ name: "R", environment: "local", tags: ["@p 0"] }, TAGS],
    [{ name: "R", environment: "local", tags: [0] }, TAGS],
    [{ name: "R", environment: "local", tags: Array.from({ length: MAX_CAMPAIGN_TAGS + 1 }, (_, index) => `@t${index}`) }, TAGS],
    [{ name: "R", environment: "local", scope: {} }, "scope is not a field of a plan of a campaign."],
  ] as const) {
    it(`is refused, naming what is at fault, when it is ${JSON.stringify(body).slice(0, 60)}`, () => {
      const refusal = refusalOf(() => campaignPlanOf(body));
      assert.deepEqual([refusal.failure, refusal.message], ["invalid_request", message]);
    });
  }

  it("is read by the pipe of the route as it is by itself", () => {
    assert.deepEqual(new CampaignPlanPipe().transform({ name: "R", environment: "local" }).scope, { tags: [] });
  });
});

describe("a launch of a campaign", () => {
  it("launches every test without a body, or with an empty one, and only those that failed or were not run when it says so", () => {
    const pipe = new CampaignLaunchPipe();
    assert.deepEqual(
      [pipe.transform(undefined), pipe.transform({}), pipe.transform({ only: "failed" }), pipe.transform({ only: "not_run" })],
      [undefined, undefined, "failed", "not_run"],
    );
  });

  for (const body of [{ only: "passed" }, { only: 1 }, { every: true }, "failed"])
    it(`is refused, naming what is at fault, when it is ${JSON.stringify(body)}`, () => {
      assert.equal(refusalOf(() => new CampaignLaunchPipe().transform(body)).failure, "invalid_request");
    });
});

describe("the problems of the campaigns", () => {
  it("are unknown_campaign, with where to find them, and campaign_refused, with what the operation said", () => {
    assert.deepEqual(
      [expectedProblem(new UnknownCampaignError("c1"))?.code, expectedProblem(new UnknownCampaignError("c1"))?.detail],
      ["unknown_campaign", "The instance keeps no campaign c1. List the campaigns it keeps with GET /campaigns."],
    );
    assert.deepEqual([expectedProblem(new CampaignRefusedError("No."))?.status, expectedProblem(new CampaignRefusedError("No."))?.detail], [409, "No."]);
  });
});
