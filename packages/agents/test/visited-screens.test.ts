import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEvent } from "@open-qa-stack/domain";
import { visitedScreens } from "../src/source-cartographer/visited-screens.ts";

const result = (tool: string, value: unknown): AgentEvent => ({ type: "tool-result", callId: tool, tool, result: value });

describe("the screens a user interface showed the agent", () => {
  it("names a screen by its path and its route after #/, keeps the latest title, and the links to other screens of the site", () => {
    const events: AgentEvent[] = [
      result("shop_goto", { url: "http://shop.test/#/policies?x=1", title: "Policies" }),
      result("shop_snapshot", { url: "http://shop.test/#/policies", title: "All policies", page: '- link "A" [ref=e1]:\n  - /url: "#/policies/7"\n- link "B":\n  - /url: \'/customers\'\n- link "Self":\n  - /url: "#/policies"\n- link "Out":\n  - /url: https://other.test/\n- link "Bad":\n  - /url: "http://[x"' }),
      result("shop_goto", { url: "https://other.test/", title: "Other" }),
      result("shop_click", { error: "No such element." }),
      result("shop_console", [{ type: "log", text: "x" }]),
      result("shop_goto", { url: 42, title: "Not a state" }),
      result("shop_snapshot", { url: "http://shop.test/", title: "Home", page: 3 }),
      result("shop_admin_goto", { url: "http://shop.test/admin", title: "Admin" }),
      { type: "tool-call", callId: "c", tool: "shop_goto", arguments: {} },
      result("shop_goto", { url: "http://shop.test/customers", title: "Customers" }),
    ];
    const inventory = visitedScreens(events, "shop", "http://shop.test/");
    assert.deepEqual(inventory.items, ["/#/policies", "/admin", "/customers"]);
    assert.deepEqual(inventory.facts.get("/#/policies"), { title: "All policies", links: ["/#/policies/7", "/customers"] });
    assert.equal(visitedScreens(events.slice(0, 1), "shop", "http://shop.test/").fingerprint, inventory.fingerprint);
    assert.notEqual(visitedScreens(events, "shop", "http://shop.test:8080/").fingerprint, inventory.fingerprint);
  });
});
