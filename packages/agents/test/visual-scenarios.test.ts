import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlannedScenario } from "@open-qa-stack/domain";
import { Journal } from "../src/common/journal.ts";
import { visualScenarios } from "../src/designer/visual-scenarios.ts";

const GOTO = (path: string) => `await page.goto(${JSON.stringify(path)});`;
const CLICK = 'await page.getByRole("link", { name: "Open", exact: true }).click();';
const line = (application: string, screen: string | undefined, code: string) => ({ application, ...(screen === undefined ? {} : { screen }), code });
const scenario = (id: string, lines: ReturnType<typeof line>[], changes: Partial<PlannedScenario> = {}): PlannedScenario => ({
  id,
  title: id,
  intent: "Verifies it.",
  kind: "functional",
  level: "functional",
  case: "nominal",
  effect: "read",
  application: "shop",
  domain: "orders",
  feature: "order-list",
  sources: [],
  data: [],
  steps: [
    { action: "Do it", code: lines.map((each) => each.code), lines, expects: [] },
    { action: "A step of an earlier plan", code: [], expects: [] },
  ],
  ...changes,
});

describe("the visual scenarios of a plan", () => {
  const applications = [
    { id: "shop", name: "Shop" },
    { id: "desk", name: "Customer Desk" },
  ];

  it("are one for each screen the plan opens by an address, with the zones that change masked by their role", async () => {
    const asked: [string, string, readonly string[]][] = [];
    const screens = {
      changingRoles: async (application: string, address: string, written: readonly string[]) => {
        asked.push([application, address, written]);
        if (address === "/down") return undefined;
        return address === "/orders" ? { roles: ["cell", "status"], left: ["generic"] } : { roles: [], left: [] };
      },
    };
    const journal = new Journal();
    const plan = [
      scenario("list", [line("shop", "/orders", GOTO("/orders")), line("shop", "/orders/:id", CLICK), line("shop", undefined, GOTO("/nowhere"))]),
      scenario("rename", [line("shop", "/orders", GOTO("/orders")), line("desk", "/tickets", GOTO("/tickets")), line("ledger", "/", GOTO("/"))], {
        effect: "write",
        data: [{ value: "Mira Veldane", from: "made-up" }],
      }),
      scenario("seen", [line("shop", "/basket", GOTO("/basket")), line("shop", "/down", GOTO("/down"))]),
    ];
    const present = ["apps/shop/tests/orders/visual/visual-shop-basket.spec.ts"];
    const visual = await visualScenarios(plan, { applications, screens, tolerance: 0.02, present }, journal);
    assert.deepEqual(
      visual.map((made) => [made.id, made.application, made.domain, made.feature, made.kind]),
      [
        ["visual-shop-orders", "shop", "orders", "visual", "visual"],
        ["visual-desk-tickets", "desk", "orders", "visual", "visual"],
      ],
    );
    assert.deepEqual(visual[0]!.steps, [
      {
        action: "Open /orders and compare the screen with its reference",
        code: [GOTO("/orders")],
        lines: [{ application: "shop", screen: "/orders", code: GOTO("/orders") }],
        screenshot: { mask: ['page.getByRole("cell")', 'page.getByRole("status")'], tolerance: 0.02 },
        expects: [],
      },
    ]);
    assert.equal(visual[0]!.title, "The screen /orders of Shop looks as its reference");
    // Each screen is looked at once, with the values the tests of its application write; one a test already compares is not.
    assert.deepEqual(asked, [
      ["shop", "/orders", ["Mira Veldane"]],
      ["desk", "/tickets", []],
      ["shop", "/down", ["Mira Veldane"]],
    ]);
    assert.deepEqual(
      journal.entries().map((entry) => entry.message),
      [
        "The screen /orders of shop changes in elements a comparison does not mask: generic.",
        "No visual scenario for the screen /down of shop: the harness could not open it again.",
      ],
    );
  });
});
