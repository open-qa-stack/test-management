import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Application } from "@open-qa-stack/shared";
import { writeRequest } from "../src/designer/writer-prompt.ts";

const SHOP: Application = {
  id: "shop",
  name: "Shop",
  type: "web",
  authentication: { method: "form", accounts: [{ name: "demo", usernameEnv: "SHOP_USERNAME", passwordEnv: "SHOP_PASSWORD" }] },
  environments: [{ name: "local", uiUrl: "http://127.0.0.1:3000/" }],
};
const LEDGER: Application = {
  id: "ledger",
  name: "Ledger",
  type: "api",
  authentication: {
    method: "form",
    accounts: [
      { name: "clerk", usernameEnv: "LEDGER_USERNAME", passwordEnv: "LEDGER_PASSWORD" },
      { name: "auditor", usernameEnv: "AUDIT_USERNAME", passwordEnv: "AUDIT_PASSWORD" },
    ],
  },
  environments: [{ name: "local", apis: [{ name: "api", baseUrl: "http://127.0.0.1:8100" }] }],
};

describe("the request of the session of a scenario", () => {
  it("gives how its test signs in, the packages it may import and the sheet of the scenario, and nothing else of the plan", () => {
    assert.equal(
      writeRequest("Scenario 2 of 3.", SHOP, ["@playwright/test", "@axe-core/playwright"], "local"),
      [
        "Write the test of this scenario for the environment local.",
        "Sign-in: with the account demo; the lines of the sheet that sign in read it from process.env: keep them as they are.\nA test may import: @playwright/test, @axe-core/playwright.",
        "Scenario 2 of 3.",
      ].join("\n\n"),
    );
  });

  it("names the variables a test reads without a user interface, and says when the application has no sign-in", () => {
    assert.match(
      writeRequest("Sheet.", LEDGER, ["@playwright/test"], "local"),
      /\n\nSign-in: with the accounts clerk, auditor; a test reads process\.env\.LEDGER_USERNAME and process\.env\.LEDGER_PASSWORD, process\.env\.AUDIT_USERNAME and process\.env\.AUDIT_PASSWORD\.\nA test may import/,
    );
    assert.match(writeRequest("Sheet.", { ...SHOP, authentication: { method: "none" } }, ["@playwright/test"], "local"), /\n\nSign-in: none\.\n/);
  });
});
