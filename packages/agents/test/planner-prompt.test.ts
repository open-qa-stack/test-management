import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Application } from "@open-qa-stack/shared";
import { PLANNER_INSTRUCTIONS, planRequest } from "../src/designer/planner-prompt.ts";

const SHOP: Application = {
  id: "shop",
  name: "Shop",
  type: "web",
  authentication: {
    method: "form",
    accounts: [
      { name: "demo", usernameEnv: "SHOP_USERNAME", passwordEnv: "SHOP_PASSWORD" },
      { name: "admin", usernameEnv: "SHOP_ADMIN_USERNAME", passwordEnv: "SHOP_ADMIN_PASSWORD" },
    ],
  },
  environments: [{ name: "local", uiUrl: "http://127.0.0.1:3000/" }],
};
const LEDGER: Application = {
  id: "ledger",
  name: "Ledger",
  type: "api",
  authentication: { method: "form", accounts: [{ name: "clerk", usernameEnv: "LEDGER_USERNAME", passwordEnv: "LEDGER_PASSWORD" }] },
  environments: [{ name: "local", apis: [{ name: "api", baseUrl: "http://127.0.0.1:8100" }] }],
};
const OPEN: Application = { ...LEDGER, id: "desk", name: "Desk", authentication: { method: "none" } };
const DOMAINS = ["- orders (Orders): Placing and following an order.", "- customers (Customers): The customers of the shop."];

describe("the instructions of the agent that plans", () => {
  it("say what it is for, how the harness answers, a method whose every step says when it is done, and the rules that cause most refusals", () => {
    const sections = PLANNER_INSTRUCTIONS.split("\n\n").map((section) => section.split("\n"));
    assert.deepEqual(
      sections.map((lines) => lines[0]),
      [
        "You plan the tests of the applications of one test environment. You explore, do each journey once on the screens, then submit one test plan with propose_plan. Another agent writes each test from your plan alone: it sees nothing of this session.",
        "How this works",
        "Method. Each step says when it is done.",
        "Three rules cause most refusals",
        "Cover the brief: each business rule, each information and each behaviour it is about has a scenario that verifies it. Say in uncovered what no scenario covers and why — the application does not allow it, or the plan has no room for it; never plan another test in its place without a word.",
        "Keep with remember a fact the agents after you should know, such as a rule or a pitfall of the application.",
      ],
    );
    assert.deepEqual(
      sections[2]!.slice(1).map((step) => /^\d\. .* Done when [^.]+[.:]/.test(step)),
      [true, true, true, true],
    );
    assert.equal(sections[3]!.length, 4);
    for (const said of [
      'A result that starts with "Refused" says what is wrong',
      'A result that starts with "The plan is not accepted yet" asks you, once,',
      'returns "action", its number',
      "you never write a locator",
      "Call knowledge_domain on its domain, then with a source for what it says of it; knowledge_list finds an element by words, knowledge_read gives one.",
    ])
      assert.ok(PLANNER_INSTRUCTIONS.includes(said), said);
    // It writes no test: nothing of the charter, of the runs nor of the files is its concern.
    assert.doesNotMatch(PLANNER_INSTRUCTIONS, /run_test|propose_test|Charter|\.spec\.ts/);
    assert.doesNotMatch(PLANNER_INSTRUCTIONS, /[ \t]$/m);
    assert.ok(PLANNER_INSTRUCTIONS.length <= 2950, String(PLANNER_INSTRUCTIONS.length));
  });
});

describe("the request of the session that plans", () => {
  it("gives the brief, the domains of the knowledge, the applications with how to sign in to them, and the next call, and nothing of a test", () => {
    assert.equal(
      planRequest("Test the search of an order.", "local", DOMAINS, [SHOP, LEDGER, OPEN]),
      [
        "Plan Playwright tests for the environment local.",
        "Brief of the developer, in their words:\n<brief>\nTest the search of an order.\n</brief>",
        `Knowledge of the applications, by domain:\n${DOMAINS.join("\n")}`,
        "Applications:\n- shop (Shop, web): sign in with shop_fill and the accounts demo, admin.\n- ledger (Ledger, api): no screens; its tests sign in with the account clerk.\n- desk (Desk, api): no sign-in.",
        "Next: call knowledge_domain on the domain the brief is about, read what it needs, do the brief once on the screens, then call propose_plan.",
      ].join("\n\n"),
    );
  });

  it("gives the same domains without a brief, and asks then for the tests that matter most", () => {
    // A user interface of another environment is none of this one's.
    const elsewhere = { ...SHOP, environments: [{ name: "staging", uiUrl: "http://shop.test" }] };
    const request = planRequest(undefined, "local", DOMAINS, [elsewhere]);
    assert.match(
      request,
      /^Plan .*\n\nNo brief was given: plan the tests that matter most across the domains below\.\n\nKnowledge of the applications, by domain:\n- orders/,
    );
    assert.match(request, /- shop \(Shop, web\): no screens; its tests sign in with the accounts demo, admin\./);
    assert.ok(
      request.endsWith(
        "\n\nNext: call knowledge_domain on the domains above that matter most, read what they hold, do it once on the screens, then call propose_plan.",
      ),
    );
  });
});
