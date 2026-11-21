import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { CampaignCounts } from "@open-qa-stack/domain/sessions";
import { CampaignVerdictBadge } from "../../src/campaigns/campaign-verdict.tsx";
import { render } from "../render.ts";

/** The counts of a campaign of no test, each test given next. */
const NONE: CampaignCounts = { passed: 0, flaky: 0, failed: 0, skipped: 0, not_run: 0 };

/** The badge of the verdict of a campaign of the counts given, as HTML. */
const badge = (counts: CampaignCounts): string => render(createElement(CampaignVerdictBadge, { counts }));

describe("the badge of the verdict of a campaign", () => {
  it("says it passes when each test passed, flaky ones included, and that it does not as soon as one did not pass", () => {
    assert.equal(badge({ ...NONE, passed: 2, flaky: 1 }), '<span class="badge ok">passe</span>');
    assert.equal(badge({ ...NONE, passed: 2, not_run: 1 }), '<span class="badge ko">ne passe pas</span>');
  });

  it("shows nothing for a campaign of no test", () => {
    assert.equal(badge(NONE), "");
  });
});
