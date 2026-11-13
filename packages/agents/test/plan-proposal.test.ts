import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlannedScenario, PlanReview, TestPlan, ToolDefinition } from "@open-qa-stack/domain";
import { Journal } from "../src/common/journal.ts";
import { PlanProposal, type PlanRules } from "../src/designer/plan-proposal.ts";
import { ScreenWatch } from "../src/designer/screen-watch.ts";

const scenario = (id: string, changes: Partial<PlannedScenario> = {}): PlannedScenario => ({
  id,
  title: `The ${id} scenario`,
  intent: `Verifies ${id}.`,
  kind: "other",
  case: "nominal",
  application: "shop",
  domain: "orders",
  sources: [{ source: "shop" }],
  data: [],
  steps: [{ action: "Open the orders", expects: [{ result: "The orders show", shows: ["Orders"], absent: [] }] }],
  ...changes,
});
const plan = (...ids: string[]): TestPlan => ({ scenarios: ids.map((id) => scenario(id)) });

/** The browser tools of a shop whose search makes an order appear and another go. */
function shopTools(): ToolDefinition[] {
  let page = '- heading "Orders"\n- row "ORD-1057 Lena Brook"';
  const tool = (action: string, execute: () => unknown): ToolDefinition => ({ name: `shop_${action}`, description: action, parameters: { type: "object" }, execute: async () => execute() });
  return [
    tool("goto", () => ({ url: "/orders" })),
    tool("snapshot", () => ({ page, truncated: false })),
    tool("click", () => {
      page = '- heading "Orders"\n- row "ORD-1042 Mira Veldane"';
      return {};
    }),
    tool("fill", () => ({})),
    tool("select_option", () => ({})),
    tool("check", () => ({})),
  ];
}

/** A plan proposal of the shop, whose screens the agent watched, and which accepts every plan by default. */
function proposal(changes: Partial<PlanRules> = {}): { proposal: PlanProposal; screens: ScreenWatch; journal: Journal } {
  const journal = new Journal();
  const screens = new ScreenWatch(["shop"], shopTools());
  const rules: PlanRules = { sources: ["shop"], applications: ["shop", "ledger"], domains: ["orders"], secrets: [], screens, review: { review: async () => ({ accepted: true }) }, carry: () => "Scenario 1.", ...changes };
  return { proposal: new PlanProposal(rules, journal), screens, journal };
}

/** A review that answers once both plans were submitted, so that the two are reviewed at once. */
function slowReview(decision: (plan: TestPlan) => boolean): PlanReview {
  return { review: async (submitted) => new Promise((resolve) => setTimeout(() => resolve(decision(submitted) ? { accepted: true } : { accepted: false, reason: "Not this one." }), 20)) };
}

const submit = (proposal: PlanProposal, submitted: TestPlan) => proposal.tool().execute(submitted) as Promise<string | { error: string }>;
const act = (screens: ScreenWatch, action: string) => screens.tools().find((tool) => tool.name === `shop_${action}`)!.execute({});

describe("plans reviewed at once", () => {
  it("keep the first one accepted, and refuse the other", async () => {
    const { proposal: made, journal } = proposal({ review: slowReview(() => true) });
    const [first, second] = await Promise.all([submit(made, plan("a", "b", "c")), submit(made, plan("x", "y", "z"))]);
    assert.equal(first, "The plan was accepted.\n\nScenario 1.");
    assert.deepEqual(second, { error: "A plan was already accepted; carry it out." });
    assert.deepEqual(made.accepted, plan("a", "b", "c"));
    assert.equal(journal.entries().filter((entry) => entry.message.startsWith("The plan was accepted")).length, 1);
  });

  it("stop at the first refusal, and never keep the other", async () => {
    const { proposal: made } = proposal({ review: slowReview((submitted) => submitted.scenarios[0]!.id === "x") });
    const [first, second] = await Promise.all([submit(made, plan("a", "b", "c")), submit(made, plan("x", "y", "z"))]);
    assert.deepEqual(first, { error: "The plan was refused: Not this one. The design is stopped; call no more tools." });
    assert.deepEqual(second, first);
    assert.deepEqual([made.accepted, made.refused, made.reminder()], [undefined, "Not this one.", undefined]);
  });
});

describe("the gates of a plan", () => {
  const found = { result: "The order of Mira Veldane shows", shows: ["ORD-1042"], absent: [] };
  const functional = (id: string, changes: Partial<PlannedScenario> = {}) => scenario(id, { kind: "functional", steps: [{ action: "Open the orders", expects: [] }, { action: "Search the orders of Veldane", expects: [found] }], ...changes });

  it("refuse, all at once and each with its code, a plan without a negative scenario and expects that name no text", async () => {
    const { proposal: made, journal } = proposal();
    const empty = { result: "Something shows", shows: [], absent: [] };
    const submitted = { scenarios: [functional("a", { steps: [{ action: "Open the orders", expects: [empty] }] }), functional("b", { steps: [{ action: "Open the orders", expects: [] }] }), scenario("c")] };
    assert.deepEqual(await submit(made, submitted), {
      error: [
        'Refused (PLAN-NEGATIVE): no scenario is negative. One must verify what the application answers when the input matches nothing, is wrong or is forbidden; set its case to "negative".',
        "Refused (PLAN-EXPECT): expect 1.1 of scenario a names no text. Give in shows the exact text the screen displays after the action, or in absent the text it no longer displays, as you read it: a name, a number, a message.",
        "Refused (PLAN-EXPECT): no step of scenario b has an expect. Give in shows the exact text the screen displays after the action, or in absent the text it no longer displays, as you read it: a name, a number, a message.",
        "Nothing else was refused.",
      ].join("\n"),
    });
    assert.deepEqual(journal.entries().map((entry) => entry.message.split(":")[0]), ["[PLAN-NEGATIVE] The plan was refused by the harness", "[PLAN-EXPECT] The plan was refused by the harness", "[PLAN-EXPECT] The plan was refused by the harness"]);
    assert.equal(made.reminder(), "You stopped before the end. The plan was last refused for: PLAN-NEGATIVE, PLAN-EXPECT.\nNext: read what the brief is about and do it once on the screens, then call propose_plan.");
  });

  it("refuse a functional scenario whose texts no action of the agent made appear or go, until one did", async () => {
    const { proposal: made, screens } = proposal();
    const submitted = { scenarios: [functional("a"), functional("b", { case: "negative", steps: [{ action: "Search the orders of Veldane", expects: [{ result: "The other order goes", shows: [], absent: ["ORD-1057"] }] }] }), scenario("c")] };
    assert.equal(made.reminder(), "You stopped before the end. No plan is accepted yet.\nNext: read what the brief is about and do it once on the screens, then call propose_plan.");
    await act(screens, "goto");
    const refused = (await submit(made, submitted)) as { error: string };
    assert.deepEqual(refused.error.split("\n").map((line) => line.split(" expects")[0]), [
      "Refused (PLAN-RESULT): no text scenario a",
      "Refused (PLAN-RESULT): no text scenario b",
      "Nothing else was refused.",
    ]);
    assert.match(refused.error, /after an action of yours on shop\. Do its steps with shop_fill and shop_click, read what the result says appeared and went, and expect that\./);
    await act(screens, "click");
    assert.equal(await submit(made, submitted), "The plan was accepted.\n\nScenario 1.");
    assert.equal(made.reminder(), undefined);
  });

  it("hold a scenario of an application without a user interface, or of another kind, to none of the screens, and one functional scenario to no negative one", async () => {
    const { proposal: made } = proposal();
    const submitted = { scenarios: [functional("a", { application: "ledger" }), scenario("b", { steps: [{ action: "Open the orders", expects: [] }] }), scenario("c")] };
    assert.equal(await submit(made, submitted), "The plan was accepted.\n\nScenario 1.");
  });

  it("refuse the value of a declared variable wherever the plan holds it", async () => {
    const { proposal: made } = proposal({ secrets: [{ variable: "SHOP_PASSWORD", value: "s3cret-pass" }] });
    const steps = [{ action: "Sign in", expects: [{ result: "Signed in", shows: ["Welcome"], absent: ["s3cret-pass"] }] }];
    assert.deepEqual(await submit(made, { scenarios: [scenario("a", { steps }), scenario("b", { data: [{ value: "s3cret-pass", from: "made-up" }] }), scenario("c")] }), {
      error: "Refused (PLAN-SECRET): the plan holds the value of SHOP_PASSWORD. Leave it out; a test reads it with process.env.SHOP_PASSWORD.\nNothing else was refused.",
    });
  });
});
