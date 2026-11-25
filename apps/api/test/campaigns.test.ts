import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CampaignRefusedError, UnknownCampaignError } from "@open-qa-stack/domain";
import { campaignPlanOf, MAX_CAMPAIGN_DETAIL_LENGTH, MAX_CAMPAIGN_NAME_LENGTH } from "../src/campaigns/campaign-plan.ts";
import { campaignTestsOf, MAX_CAMPAIGN_TESTS } from "../src/campaigns/campaign-tests.ts";
import { CampaignTestsPipe } from "../src/campaigns/campaign-tests.pipe.ts";
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
  it("names the campaign and its environment", () => {
    assert.deepEqual(campaignPlanOf({ name: " Recette ", environment: "local" }), { name: "Recette", environment: "local" });
    assert.equal(campaignPlanOf({ name: "x".repeat(MAX_CAMPAIGN_NAME_LENGTH), environment: "local" }).name.length, MAX_CAMPAIGN_NAME_LENGTH);
  });

  it("says what the campaign is for, the version it tests, its days and who answers for it, when they are given", () => {
    const details = { objective: "Ship", targetVersion: "4.2", startsOn: "2026-12-01", endsOn: "2026-12-05", owner: "QA" };
    assert.deepEqual(campaignPlanOf({ name: "R", environment: "local", ...details, objective: " Ship " }), { name: "R", environment: "local", ...details });
  });

  const OWNER = `owner must be a text that is not empty, does not start with -- and is at most ${MAX_CAMPAIGN_DETAIL_LENGTH} characters long, or be left out.`;
  const NAME = `name must be a text that is not empty, does not start with -- and is at most ${MAX_CAMPAIGN_NAME_LENGTH} characters long.`;
  const ENVIRONMENT = "environment must be a text that is not empty and does not start with --.";
  for (const [body, message] of [
    [[], "The body must be a JSON object."],
    [{ environment: "local" }, NAME],
    [{ name: " ", environment: "local" }, NAME],
    [{ name: "--x", environment: "local" }, NAME],
    [{ name: "x".repeat(MAX_CAMPAIGN_NAME_LENGTH + 1), environment: "local" }, NAME],
    [{ name: "R" }, ENVIRONMENT],
    [{ name: "R", environment: "--x" }, ENVIRONMENT],
    [{ name: "R", environment: "local", owner: " " }, OWNER],
    [{ name: "R", environment: "local", owner: "x".repeat(MAX_CAMPAIGN_DETAIL_LENGTH + 1) }, OWNER],
    [{ name: "R", environment: "local", tags: ["@p0"] }, "tags is not a field of a plan of a campaign."],
  ] as const) {
    it(`is refused, naming what is at fault, when it is ${JSON.stringify(body).slice(0, 60)}`, () => {
      const refusal = refusalOf(() => campaignPlanOf(body));
      assert.deepEqual([refusal.failure, refusal.message], ["invalid_request", message]);
    });
  }

  it("is read by the pipe of the route as it is by itself", () => {
    assert.deepEqual(new CampaignPlanPipe().transform({ name: "R", environment: "local" }), { name: "R", environment: "local" });
  });
});

describe("a choice of the tests of a campaign", () => {
  it("names each test by the path of its file and its title", () => {
    const tests = [{ path: "apps/a.spec.ts", title: "A" }];
    assert.deepEqual(campaignTestsOf({ tests }), tests);
    assert.deepEqual(new CampaignTestsPipe().transform({ tests: [] }), []);
    assert.equal(campaignTestsOf({ tests: Array.from({ length: MAX_CAMPAIGN_TESTS }, () => tests[0]) }).length, MAX_CAMPAIGN_TESTS);
  });

  const TESTS = `tests must be a list of at most ${MAX_CAMPAIGN_TESTS} tests, each a path and a title as the repository lists them.`;
  for (const [body, message] of [
    [{}, TESTS],
    [{ tests: "apps/a.spec.ts" }, TESTS],
    [{ tests: ["apps/a.spec.ts"] }, TESTS],
    [{ tests: [null] }, TESTS],
    [{ tests: [[]] }, TESTS],
    [{ tests: [{ path: "apps/a.spec.ts" }] }, TESTS],
    [{ tests: [{ path: "", title: "A" }] }, TESTS],
    [{ tests: [{ path: "apps/a.spec.ts", title: "" }] }, TESTS],
    [{ tests: [{ path: "apps/a.spec.ts", title: "A", tags: [] }] }, TESTS],
    [{ tests: Array.from({ length: MAX_CAMPAIGN_TESTS + 1 }, () => ({ path: "a", title: "A" })) }, TESTS],
    [{ tests: [], tags: [] }, "tags is not a field of a choice of the tests of a campaign."],
  ] as const) {
    it(`is refused, naming what is at fault, when it is ${JSON.stringify(body).slice(0, 60)}`, () => {
      assert.deepEqual(refusalOf(() => campaignTestsOf(body)).message, message);
    });
  }
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
