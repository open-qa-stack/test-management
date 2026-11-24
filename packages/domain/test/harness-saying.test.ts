import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { sayingOf, type Saying } from "../src/sessions/index.ts";

/** Texts the harness writes, each with what it is read as. */
const SAID: readonly (readonly [string, Saying])[] = [
  ["The configuration is valid; the run targets the environment local.", { code: "configurationValid", values: { environment: "local" } }],
  ["The prerequisites succeeded.", { code: "prerequisitesSucceeded", values: {} }],
  ["The cartography succeeded.", { code: "cartographySucceeded", values: {} }],
  ["The design succeeded.", { code: "designSucceeded", values: {} }],
  ["The execution succeeded.", { code: "executionSucceeded", values: {} }],
  ["The summary of the run was written.", { code: "summaryWritten", values: {} }],
  ["The card of shop-api is up to date; it was kept.", { code: "cardKept", values: { source: "shop-api" } }],
  ["The file of the domain orders is up to date; it was kept.", { code: "domainFileKept", values: { domain: "orders" } }],
  [
    "The index /home/me/shop/.oqas/index/domain-index.json is complete and made of the cards every source has now, by their fingerprints; it was kept.",
    { code: "indexKept", values: {} },
  ],
  [
    "The scenario search-customer was opened; its test is apps/shop/tests/search.spec.ts.",
    { code: "scenarioOpened", values: { scenario: "search-customer", test: "apps/shop/tests/search.spec.ts" } },
  ],
  ["The test apps/shop/tests/search.spec.ts was written.", { code: "testWritten", values: { test: "apps/shop/tests/search.spec.ts" } }],
  ["The test apps/shop/tests/search.spec.ts was run: passed.", { code: "testPassed", values: { test: "apps/shop/tests/search.spec.ts" } }],
  ["The test apps/shop/tests/search.spec.ts was run: failed.", { code: "testFailed", values: { test: "apps/shop/tests/search.spec.ts" } }],
  ["Scenario search-customer: 8 calls beyond its sheet.", { code: "callsBeyondSheet", values: { scenario: "search-customer", count: "8" } }],
  [
    "[SHEET-BEYOND] Scenario search-customer, after failed run 1: shop_network.",
    { code: "callBeyondSheet", values: { scenario: "search-customer", run: "1", tool: "shop_network" } },
  ],
  ["The plan was written to .oqas/designs/design.plan.md.", { code: "planWritten", values: { file: ".oqas/designs/design.plan.md" } }],
  ["The design state was written to .oqas/designs/design.json.", { code: "designWritten", values: { file: ".oqas/designs/design.json" } }],
  [
    "The design state was written to .oqas/designs/design.json, and its plan to .oqas/designs/design.plan.md; no new test was written, and nothing was committed.",
    { code: "designWrittenNothing", values: { file: ".oqas/designs/design.json", plan: ".oqas/designs/design.plan.md" } },
  ],
  [
    "The tests were committed on oqas/design-1; the active branch of the test repository is oqas/design-1.",
    { code: "testsCommitted", values: { branch: "oqas/design-1", active: "oqas/design-1" } },
  ],
  ["The plan was accepted: no scenario.", { code: "planAcceptedEmpty", values: {} }],
  ["The plan was accepted: search-customer, open-order.", { code: "planAccepted", values: { scenarios: "search-customer, open-order" } }],
  ["No test was written: the plan holds no scenario, and says what the brief asks that no test can do.", { code: "noTestEmptyPlan", values: {} }],
  ["No test was written: the plan holds no scenario, the tests already written covering the brief.", { code: "noTestCovered", values: {} }],
  ["The harness asked for no more scenarios: the plan holds as many scenarios as it may.", { code: "planFull", values: {} }],
  [
    "The plan is full at 2, and had no room for: open-order, cancel-order.",
    { code: "planNoRoom", values: { count: "2", scenarios: "open-order, cancel-order" } },
  ],
  ["The harness asked for no more scenarios: the agent said the brief is covered.", { code: "briefCovered", values: {} }],
  [
    "The harness asked for no more scenarios: the scenarios last submitted were duplicates, and the agent has nothing new to verify.",
    { code: "onlyDuplicates", values: {} },
  ],
  ["The harness asked for no more scenarios: the agent said no test can do what the brief asks.", { code: "briefUnfeasible", values: {} }],
  [
    "The harness asked the agent to confirm that the test of search-customer fails because of the application, with runs left.",
    { code: "askedConfirmation", values: { scenario: "search-customer" } },
  ],
  [
    "The scenario home-smoke was set aside as a duplicate of apps/shop/tests/home.spec.ts, by the harness (PLAN-EXISTING): The test already does it.",
    {
      code: "setAsideByHarness",
      values: { scenario: "home-smoke", of: "apps/shop/tests/home.spec.ts", rule: "PLAN-EXISTING", reason: "The test already does it." },
    },
  ],
  [
    "The scenario home-list was set aside as a duplicate of home-smoke, by the plan reviewer: Les deux ouvrent l’accueil.",
    { code: "setAsideByReviewer", values: { scenario: "home-list", of: "home-smoke", reason: "Les deux ouvrent l’accueil." } },
  ],
  [
    "The harness left out an answer of the plan reviewer: home-list as a duplicate of apps/shop/tests/home.spec.ts.",
    { code: "answerLeftOut", values: { scenario: "home-list", of: "apps/shop/tests/home.spec.ts" } },
  ],
  [
    "The coherence reviewer found fault with the test of home-list: Étape 2 : rien n’est vérifié.",
    { code: "coherenceFault", values: { scenario: "home-list", remark: "Étape 2 : rien n’est vérifié." } },
  ],
  ["The code reviewer found fault with the test of home-list: Étape 3.", { code: "codeFault", values: { scenario: "home-list", remark: "Étape 3." } }],
  [
    'The harness warned the agent (2) that 3 elements share page.getByText("Home", { exact: true }), which shows "Home".',
    { code: "sharedLocator", values: { count: "3", shown: '"Home"' } },
  ],
  ["6 of the 6 tests designed are run; left out as unfinished, duplicate or unfeasible: none.", { code: "allTestsRun", values: { run: "6", designed: "6" } }],
  [
    "5 of the 6 tests designed are run; left out as unfinished, duplicate or unfeasible: open-order.",
    { code: "testsRun", values: { run: "5", designed: "6", left: "open-order" } },
  ],
  ["passed: shop › shop/tests/search.spec.ts:3 › Search a customer.", { code: "verdictPassed", values: { title: "Search a customer" } }],
  ["failed: shop › shop/tests/search.spec.ts:3 › Search a customer.", { code: "verdictFailed", values: { title: "Search a customer" } }],
  ["Every attempt passed.", { code: "everyAttemptPassed", values: {} }],
  ["The plan was refused by the harness", { code: "planRefusedByHarness", values: {} }],
  ["The plan was refused", { code: "planRefused", values: {} }],
  ["The plan does not cover what the brief asks", { code: "planUncovered", values: {} }],
  ["No test was written", { code: "noTestWritten", values: {} }],
];

describe("what the harness says", () => {
  it("is read by the form it is written in, with the values the text names", () => {
    for (const [text, saying] of SAID) assert.deepEqual(sayingOf(text), saying, text);
  });

  it("names no path of the machine that ran", () => {
    const saying = sayingOf(SAID[8]![0]);
    assert.ok(!JSON.stringify(saying).includes("/home/"));
  });

  it("is not read when its form is not known: it is shown as it is", () => {
    assert.equal(sayingOf("The harness did something new."), undefined);
    assert.equal(sayingOf("Failed: Error: expect(locator).toBeVisible() failed"), undefined);
  });
});
