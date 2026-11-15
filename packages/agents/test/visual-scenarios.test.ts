import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlannedScenario } from "@open-qa-stack/domain";
import { Journal } from "../src/common/journal.ts";
import { visualScenarios, withComparisons } from "../src/designer/visual-scenarios.ts";

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
    // A test already there writes a value of the desk, and opens a screen of the shop the plan does not.
    const existing = [
      { verified: { application: "desk", data: [], steps: [] }, writes: ["Ticket 12"], domain: "support", opens: [line("shop", "/returns", GOTO("/returns"))] },
    ];
    const present = ["apps/shop/tests/orders/visual/visual-shop-basket.spec.ts"];
    const visual = await visualScenarios(plan, { applications, screens, seen: { holdingRoles: () => [] }, tolerance: 0.02, present, existing }, journal);
    assert.deepEqual(
      visual.map((made) => [made.id, made.application, made.domain, made.feature, made.kind]),
      [
        ["visual-shop-orders", "shop", "orders", "visual", "visual"],
        ["visual-desk-tickets", "desk", "orders", "visual", "visual"],
        ["visual-shop-returns", "shop", "support", "visual", "visual"],
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
    // Each screen is looked at once, with the values the tests of its application write, those of the plan and those already there; one a test already compares is not.
    assert.deepEqual(asked, [
      ["shop", "/orders", ["Mira Veldane"]],
      ["desk", "/tickets", ["Ticket 12"]],
      ["shop", "/down", ["Mira Veldane"]],
      ["shop", "/returns", ["Mira Veldane"]],
    ]);
    assert.deepEqual(
      journal.entries().map((entry) => entry.message),
      [
        "The screen /orders of shop changes in elements a comparison does not mask: generic.",
        "No visual scenario for the screen /down of shop: the harness could not open it again.",
      ],
    );
  });

  it("end the visual scenarios an agent planned with their comparison, masked by what the harness sees or by what the agent saw", async () => {
    const looked: string[] = [];
    const rules = {
      applications,
      screens: {
        changingRoles: async (_application: string, address: string) => {
          looked.push(address);
          return address === "/down" ? undefined : { roles: ["status"], left: [] };
        },
      },
      seen: { holdingRoles: (application: string) => (application === "desk" ? ["cell"] : ["row"]) },
      tolerance: 0.02,
      present: [],
      existing: [],
    };
    const visual = (id: string, lines: ReturnType<typeof line>[], changes: Partial<PlannedScenario> = {}) =>
      scenario(id, lines, { kind: "visual", steps: [{ action: "Reach the state", code: lines.map((each) => each.code), lines, expects: [] }], ...changes });
    const opened = visual("orders", [line("shop", "/orders", GOTO("/orders"))]);
    const dialog = visual("dialog", [line("shop", "/orders", GOTO("/orders")), line("shop", "/orders", CLICK)]);
    const down = visual("down", [line("shop", "/down", GOTO("/down"))]);
    const elsewhere = visual("ticket", [line("desk", "/tickets", GOTO("/tickets")), line("desk", "/tickets", CLICK)], { applications: ["desk"] });
    const crossing = { ...elsewhere, steps: [{ ...elsewhere.steps[0]!, application: "desk" }] };
    const kept = { ...opened, id: "kept", steps: [{ ...opened.steps[0]!, screenshot: { mask: [], tolerance: 0.5 } }] };
    const other = scenario("other", [line("shop", "/orders", GOTO("/orders"))]);
    const empty = { ...opened, id: "empty", steps: [] };
    const compared = await withComparisons([opened, dialog, down, crossing, kept, other, empty], rules);
    assert.deepEqual(
      compared.map((made) => made.steps.at(-1)?.screenshot),
      [
        { mask: ['page.getByRole("status")'], tolerance: 0.02 },
        { mask: ['page.getByRole("row")'], tolerance: 0.02 },
        { mask: ['page.getByRole("row")'], tolerance: 0.02 },
        { mask: ['page.getByRole("cell")'], tolerance: 0.02 },
        { mask: [], tolerance: 0.5 },
        undefined,
        undefined,
      ],
    );
    assert.deepEqual(looked, ["/orders", "/down"]);
    // A screen a visual scenario of the plan compares as it opens has no other comparison.
    assert.deepEqual(
      (await visualScenarios([compared[0]!, compared[1]!], rules, new Journal())).map((made) => made.id),
      [],
    );
  });
});
