import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Application } from "@open-qa-stack/shared";
import { designRequest } from "../src/designer/designer-prompt.ts";

const SHOP: Application = {
  id: "shop",
  name: "Shop",
  type: "web",
  authentication: { method: "form", accounts: [{ name: "demo", usernameEnv: "SHOP_USERNAME", passwordEnv: "SHOP_PASSWORD" }, { name: "admin", usernameEnv: "SHOP_ADMIN_USERNAME", passwordEnv: "SHOP_ADMIN_PASSWORD" }] },
  environments: [{ name: "local", uiUrl: "http://127.0.0.1:3000/" }],
};
const LEDGER: Application = { id: "ledger", name: "Ledger", type: "api", authentication: { method: "form", accounts: [{ name: "clerk", usernameEnv: "LEDGER_USERNAME", passwordEnv: "LEDGER_PASSWORD" }] }, environments: [{ name: "local", apis: [{ name: "api", baseUrl: "http://127.0.0.1:8100" }] }] };
const DOMAINS = ["- orders (Orders): Placing and following an order.", "- customers (Customers): The customers of the shop.", "- invoices (Invoices): What a customer is billed."];

describe("the request of a design", () => {
  it("gives the brief, what the index holds for it, the applications, the packages and the next call, and nothing of the rules", () => {
    const found = ["Domains:", DOMAINS[0]!, "Elements:", "- shop: /orders (screen)"];
    assert.equal(
      designRequest("Test the search of an order.", "local", found, DOMAINS, [SHOP, LEDGER], ["@playwright/test"]),
      [
        "Design Playwright tests for the environment local.",
        "Brief of the developer, in their words:\n<brief>\nTest the search of an order.\n</brief>",
        `What the index holds for this brief:\n${found.join("\n")}`,
        "Applications:\n- shop (Shop, web): sign in with shop_fill and the accounts demo, admin; the result gives the line a test writes.\n- ledger (Ledger, api): sign in with the account clerk; a test reads process.env.LEDGER_USERNAME and process.env.LEDGER_PASSWORD.",
        "A test may import: @playwright/test.",
        "Next: call index_entry on the elements above that the brief is about, read them, do the brief once on the screens, then call propose_plan.",
      ].join("\n\n"),
    );
  });

  it("gives the domains of the index when nothing echoes the brief, or without one", () => {
    assert.match(designRequest("zebra", "local", [], DOMAINS, [SHOP], ["@playwright/test"]), /<\/brief>\n\nDomains of the index:\n- orders/);
    const request = designRequest(undefined, "local", [], DOMAINS, [{ ...SHOP, environments: [{ name: "staging", uiUrl: "http://shop.test" }] }], ["@playwright/test"]);
    assert.match(request, /^Design .*\n\nNo brief was given: design the tests that matter most across the domains below\.\n\nDomains of the index:\n/);
    // A user interface of another environment is none of this one's.
    assert.match(request, /- shop \(Shop, web\): sign in with the accounts demo, admin; a test reads process\.env\.SHOP_USERNAME and process\.env\.SHOP_PASSWORD, process\.env\.SHOP_ADMIN_USERNAME and process\.env\.SHOP_ADMIN_PASSWORD\./);
    assert.ok(request.endsWith("\n\nNext: call index_entry on the domains above that matter most, read what they hold, do it once on the screens, then call propose_plan."));
  });
});
