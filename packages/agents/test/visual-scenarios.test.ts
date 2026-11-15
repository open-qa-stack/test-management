import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlannedScenario } from "@open-qa-stack/domain";
import { uncomparedScreens, withComparisons } from "../src/designer/visual-scenarios.ts";

const GOTO = (path: string) => `await page.goto(${JSON.stringify(path)});`;
const line = (application: string, screen: string | undefined, code: string) => ({ application, ...(screen === undefined ? {} : { screen }), code });
const scenario = (id: string, kind: PlannedScenario["kind"], steps: PlannedScenario["steps"]): PlannedScenario => ({
  id,
  title: id,
  intent: "Verifies it.",
  kind,
  level: "functional",
  case: "nominal",
  effect: "read",
  application: "shop",
  domain: "orders",
  feature: "order-list",
  sources: [],
  data: [],
  steps,
});
const step = (action: string) => ({ action, code: [], expects: [] });

describe("the visual scenarios an agent planned", () => {
  it("end with the comparison of their last step, at the tolerance given, and the others are left as they are", () => {
    const dialog = scenario("dialog", "visual", [step("Open the orders"), step("Open the dialog")]);
    const kept = scenario("kept", "visual", [{ ...step("Open the orders"), screenshot: { tolerance: 0.5 } }]);
    const other = scenario("other", "functional", [step("Open the orders")]);
    const empty = scenario("empty", "visual", []);
    assert.deepEqual(
      withComparisons([dialog, kept, other, empty], 0.02).map((made) => made.steps.map((each) => each.screenshot)),
      [[undefined, { tolerance: 0.02 }], [{ tolerance: 0.5 }], [undefined], []],
    );
  });
});

describe("the screens the tests of a repository open and none of its visual tests compares", () => {
  it("are named by their application and their route, each once, for the agent that plans visual tests to say what to make of them", () => {
    const test = (visual: boolean, ...opens: ReturnType<typeof line>[]) => ({ visual, opens });
    assert.deepEqual(
      uncomparedScreens([
        test(false, line("shop", "/orders", GOTO("/orders")), line("shop", "/basket", GOTO("/basket")), line("shop", undefined, GOTO("/nowhere"))),
        test(false, line("shop", "/orders", GOTO("/orders")), line("desk", "/tickets", GOTO("/tickets"))),
        test(true, line("shop", "/basket", GOTO("/basket"))),
      ]),
      ["shop /orders", "desk /tickets"],
    );
    assert.deepEqual(uncomparedScreens([]), []);
  });
});
