import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlannedScenario, PlanReview, TestPlan, ToolDefinition } from "@open-qa-stack/domain";
import { Journal } from "../src/common/journal.ts";
import { PlanProposal, type PlanRules } from "../src/designer/plan-proposal.ts";
import { ScreenWatch } from "../src/designer/screen-watch.ts";
import { SourceWatch } from "../src/designer/source-watch.ts";

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

/** The browser tools of a shop whose search makes an order appear and another go, and whose search field takes the value typed, zzqx when none is given. */
function shopTools(): ToolDefinition[] {
  let page = '- heading "Orders"\n- row "ORD-1057 Lena Brook"';
  const tool = (action: string, execute: (args: { value?: string }) => unknown): ToolDefinition => ({
    name: `shop_${action}`,
    description: action,
    parameters: { type: "object" },
    execute: async (args) => execute(args as { value?: string }),
  });
  return [
    tool("goto", () => ({ url: "/orders" })),
    tool("snapshot", () => ({ page, truncated: false })),
    tool("click", () => {
      page = '- heading "Orders"\n- row "ORD-1042 Mira Veldane"';
      return {};
    }),
    tool("fill", ({ value = "zzqx" }) => {
      page = `${page}\n- textbox "Search orders": ${value} → page.getByRole("textbox", { name: "Search orders", exact: true })`;
      return {};
    }),
    tool("select_option", () => ({})),
    tool("check", () => ({})),
  ];
}

/** The tools of a base of orders and of a guide; the base finds the order of Mira Veldane, the guide cannot be read. */
function sourceTools(): ToolDefinition[] {
  const tool = (name: string, execute: () => unknown): ToolDefinition => ({
    name,
    description: name,
    parameters: { type: "object" },
    execute: async () => execute(),
  });
  return [
    tool("orders_db_search", () => ({
      rows: [
        { id: "ORD-1042", customer: "Mira  Veldane" },
        { id: 7, note: "", detail: "Long ".repeat(50) },
      ],
    })),
    tool("orders_db_query", () => ({ error: "Unknown column." })),
    tool("guide_read_section", () => ({ error: "No such section." })),
  ];
}

/** A plan proposal of the shop, whose orders page the agent opened unless told otherwise, and which accepts every plan by default. */
async function proposal(
  changes: Partial<PlanRules> = {},
  opened = true,
): Promise<{ proposal: PlanProposal; screens: ScreenWatch; reads: SourceWatch; journal: Journal }> {
  const journal = new Journal();
  const screens = new ScreenWatch(["shop"], shopTools());
  const reads = new SourceWatch(
    [
      { id: "orders-db", type: "postgresql" },
      { id: "guide", type: "document" },
      { id: "specs", type: "document" },
    ],
    sourceTools(),
    [],
  );
  if (opened) await act(screens, "goto");
  const rules: PlanRules = {
    sources: ["shop", "orders-db", "guide", "specs"],
    applications: ["shop", "ledger"],
    domains: ["orders"],
    secrets: [],
    screens,
    reads,
    review: { review: async () => ({ accepted: true }) },
    carry: () => "Scenario 1.",
    ...changes,
  };
  return { proposal: new PlanProposal(rules, journal), screens, reads, journal };
}

/** A review that answers once both plans were submitted, so that the two are reviewed at once. */
function slowReview(decision: (plan: TestPlan) => boolean): PlanReview {
  return {
    review: async (submitted) =>
      new Promise((resolve) => setTimeout(() => resolve(decision(submitted) ? { accepted: true } : { accepted: false, reason: "Not this one." }), 20)),
  };
}

const submit = (proposal: PlanProposal, submitted: TestPlan) => proposal.tool().execute(submitted) as Promise<string | { error: string }>;
const act = (screens: ScreenWatch, action: string, args: object = {}) =>
  screens
    .tools()
    .find((tool) => tool.name === `shop_${action}`)!
    .execute(args);

describe("plans reviewed at once", () => {
  it("keep the first one accepted, and refuse the other", async () => {
    const { proposal: made, journal } = await proposal({ review: slowReview(() => true) });
    const [first, second] = await Promise.all([submit(made, plan("a", "b", "c")), submit(made, plan("x", "y", "z"))]);
    assert.equal(first, "The plan was accepted.\n\nScenario 1.");
    assert.deepEqual(second, { error: "A plan was already accepted; carry it out." });
    assert.deepEqual(made.accepted, plan("a", "b", "c"));
    assert.equal(journal.entries().filter((entry) => entry.message.startsWith("The plan was accepted")).length, 1);
  });

  it("stop at the first refusal, and never keep the other", async () => {
    const { proposal: made } = await proposal({ review: slowReview((submitted) => submitted.scenarios[0]!.id === "x") });
    const [first, second] = await Promise.all([submit(made, plan("a", "b", "c")), submit(made, plan("x", "y", "z"))]);
    assert.deepEqual(first, { error: "The plan was refused: Not this one. The design is stopped; call no more tools." });
    assert.deepEqual(second, first);
    assert.deepEqual([made.accepted, made.refused, made.reminder()], [undefined, "Not this one.", undefined]);
  });
});

describe("the gates of a plan", () => {
  const found = { result: "The order of Mira Veldane shows", shows: ["ORD-1042"], absent: [] };
  const functional = (id: string, changes: Partial<PlannedScenario> = {}) =>
    scenario(id, {
      kind: "functional",
      steps: [
        { action: "Open the orders", expects: [] },
        { action: "Search the orders of Veldane", expects: [found] },
      ],
      ...changes,
    });

  it("refuse, all at once and each with its code, a plan without a negative functional scenario and expects that name no text", async () => {
    const { proposal: made, journal } = await proposal();
    const empty = { result: "Something shows", shows: [], absent: [] };
    const submitted = {
      scenarios: [
        functional("a", { steps: [{ action: "Open the orders", expects: [empty] }] }),
        functional("b", { steps: [{ action: "Open the orders", expects: [] }] }),
        scenario("c", { kind: "visual", case: "negative" }),
      ],
    };
    // A visual scenario that is negative verifies nothing of what the application answers.
    assert.deepEqual(await submit(made, submitted), {
      error: [
        'Refused (PLAN-NEGATIVE): no functional scenario is negative. One must verify what the application answers when the input matches nothing, is wrong or is forbidden; set its case to "negative".',
        "Refused (PLAN-EXPECT): expect 1.1 of scenario a names no text. Give in shows the exact text the screen displays after the action, or in absent the text it no longer displays, as you read it: a name, a number, a message.",
        "Refused (PLAN-EXPECT): no step of scenario b has an expect. Give in shows the exact text the screen displays after the action, or in absent the text it no longer displays, as you read it: a name, a number, a message.",
        "Nothing else was refused.",
      ].join("\n"),
    });
    assert.deepEqual(
      journal.entries().map((entry) => entry.message.split(":")[0]),
      [
        "[PLAN-NEGATIVE] The plan was refused by the harness",
        "[PLAN-EXPECT] The plan was refused by the harness",
        "[PLAN-EXPECT] The plan was refused by the harness",
      ],
    );
    assert.equal(
      made.reminder(),
      "You stopped before the end. The plan was last refused for: PLAN-NEGATIVE, PLAN-EXPECT.\nNext: read what the brief is about and do it once on the screens, then call propose_plan.",
    );
  });

  it("refuse a functional scenario whose texts no action of the agent made appear or go, until one did", async () => {
    const { proposal: made, screens } = await proposal();
    const submitted = {
      scenarios: [
        functional("a"),
        functional("b", {
          case: "negative",
          steps: [{ action: "Search the orders of Veldane", expects: [{ result: "The other order goes", shows: [], absent: ["ORD-1057"] }] }],
        }),
        scenario("c"),
      ],
    };
    assert.equal(
      made.reminder(),
      "You stopped before the end. No plan is accepted yet.\nNext: read what the brief is about and do it once on the screens, then call propose_plan.",
    );
    await act(screens, "goto");
    const refused = (await submit(made, submitted)) as { error: string };
    assert.deepEqual(
      refused.error.split("\n").map((line) => line.split(/ expects|, expect /)[0]),
      [
        "Refused (PLAN-RESULT): no text scenario a",
        "Refused (PLAN-RESULT): no text scenario b",
        "Refused (PLAN-SHOWN): scenario a",
        "Nothing else was refused.",
      ],
    );
    assert.match(
      refused.error,
      /after an action of yours on shop\. Do its steps with shop_fill and shop_click, read what the result says appeared and went, and expect that\./,
    );
    await act(screens, "click");
    assert.equal(await submit(made, submitted), "The plan was accepted.\n\nScenario 1.");
    assert.equal(made.reminder(), undefined);
  });

  it("hold a scenario of an application without a user interface, or of another kind, to none of the screens, and one functional scenario to no negative one", async () => {
    const { proposal: made, reads } = await proposal();
    await reads.tools()[0]!.execute({});
    // The text an application without a user interface no longer shows is one a tool returned.
    const gone = { result: "The order of Mira Veldane goes", shows: [], absent: ["Mira Veldane"] };
    const submitted = {
      scenarios: [
        functional("a", {
          application: "ledger",
          steps: [
            { action: "Open the orders", expects: [found] },
            { action: "Cancel the order", expects: [gone] },
          ],
        }),
        scenario("b", { steps: [{ action: "Open the orders", expects: [] }] }),
        scenario("c"),
      ],
    };
    const unread = {
      ...submitted,
      scenarios: [
        functional("a", { application: "ledger", steps: [{ action: "Open the orders", expects: [{ ...found, shows: ["ORD-2001"] }] }] }),
        ...submitted.scenarios.slice(1),
      ],
    };
    assert.deepEqual(await submit(made, unread), {
      error:
        'Refused (PLAN-SHOWN): scenario a, expect 1.1, names "ORD-2001", which nothing you read in this session showed. Copy the text as a tool of a source gives it.\nNothing else was refused.',
    });
    assert.equal(await submit(made, submitted), "The plan was accepted.\n\nScenario 1.");
  });

  it("refuse the value of a declared variable wherever the plan holds it", async () => {
    const { proposal: made } = await proposal({ secrets: [{ variable: "SHOP_PASSWORD", value: "s3cret-pass" }] });
    const steps = [{ action: "Sign in", expects: [{ result: "Signed in as s3cret-pass", shows: ["Orders"], absent: [] }] }];
    assert.deepEqual(
      await submit(made, { scenarios: [scenario("a", { steps }), scenario("b", { data: [{ value: "s3cret-pass", from: "made-up" }] }), scenario("c")] }),
      {
        error:
          "Refused (PLAN-SECRET): the plan holds the value of SHOP_PASSWORD. Leave it out; a test reads it with process.env.SHOP_PASSWORD.\nNothing else was refused.",
      },
    );
  });

  it("tell only the first error of a reason refused three times, and stop the design at the sixth plan they refuse", async () => {
    const { proposal: made, journal } = await proposal();
    const twice = { scenarios: [scenario("a"), scenario("a"), scenario("b"), scenario("b")] };
    const idError = "Refused (PLAN-ID): the id a is given to several scenarios. Give each scenario its own id.";
    const told = [];
    for (let at = 0; at < 6; at += 1) told.push(((await submit(made, twice)) as { error: string }).error);
    assert.deepEqual(told.slice(0, 5), [
      `${idError}\nRefused (PLAN-ID): the id b is given to several scenarios. Give each scenario its own id.\nNothing else was refused.`,
      `${idError}\nRefused (PLAN-ID): the id b is given to several scenarios. Give each scenario its own id.\nNothing else was refused.`,
      `Third refusal for the same reason. Do only this:\n${idError}`,
      `Fourth refusal for the same reason. Do only this:\n${idError}`,
      `Fifth refusal for the same reason. Do only this:\n${idError}`,
    ]);
    assert.equal(told[5], "The plan was refused: the harness refused 6 plans, the last one for PLAN-ID. The design is stopped; call no more tools.");
    assert.deepEqual([made.refused, made.reminder()], ["the harness refused 6 plans, the last one for PLAN-ID.", undefined]);
    assert.equal(
      journal.entries().at(-1)!.message,
      "The plan was refused: the harness refused 6 plans, the last one for PLAN-ID. The design stops; no test is written.",
    );
    assert.deepEqual(await submit(made, plan("x", "y", "z")), { error: told[5] });
  });

  it("refuse a source cited and never read, a value its source never showed, and a text no tool showed, until they were", async () => {
    const { proposal: made, screens, reads } = await proposal({}, false);
    const [search, query, guide] = reads.tools();
    const data = [
      { value: "Veldane", from: "orders-db" },
      { value: "Lena Brook", from: "shop" },
      { value: "zzqx", from: "made-up" },
      { value: "Mira", from: "specs" },
      { value: "42", from: "orders-db" },
    ];
    const steps = [
      {
        action: "Search zzqx",
        expects: [{ result: "Nothing matches", shows: ["No order matches zzqx", "zzqx", "Orders"], absent: ["ORD-1057", "Lena", "Gone"] }],
      },
    ];
    const submitted = {
      scenarios: [
        scenario("a", { sources: [{ source: "orders-db" }, { source: "guide" }, { source: "shop" }, { source: "shop" }, { source: "specs" }], data, steps }),
        scenario("b"),
        scenario("c"),
      ],
    };
    // A call that failed read nothing.
    await query!.execute({});
    await guide!.execute({});
    assert.deepEqual(((await submit(made, submitted)) as { error: string }).error.split("\n"), [
      "Refused (PLAN-READ): scenario a cites orders-db, and you have read nothing of it. Call orders_db_search first.",
      "Refused (PLAN-READ): scenario a cites guide, and you have read nothing of it. Call guide_read_section first.",
      "Refused (PLAN-READ): scenario a cites shop, and you have read nothing of it. Call shop_goto first.",
      'Refused (PLAN-DATA): no result of orders-db showed "Veldane" in this session. Read it first with orders_db_search, or correct the value. A value the test invents has from "made-up".',
      'Refused (PLAN-DATA): no result of shop showed "Lena Brook" in this session. Read it first with shop_goto, or correct the value. A value the test invents has from "made-up".',
      'Refused (PLAN-SHOWN): scenario a, expect 1.1, names "No order matches zzqx", which no screen of shop showed in this session. Do the step with the browser tools and copy the text as the screen gives it.',
      'Refused (PLAN-SHOWN): scenario a, expect 1.1, names "zzqx", which no screen of shop showed in this session. Do the step with the browser tools and copy the text as the screen gives it.',
      'Refused (PLAN-SHOWN): scenario a, expect 1.1, names "Orders", which no screen of shop showed in this session. Do the step with the browser tools and copy the text as the screen gives it.',
      'Refused (PLAN-SHOWN): scenario a, expect 1.1, names "ORD-1057", which no screen of shop showed in this session. Do the step with the browser tools and copy the text as the screen gives it.',
      'Refused (PLAN-SHOWN): scenario a, expect 1.1, names "Lena", which no screen of shop showed in this session. Do the step with the browser tools and copy the text as the screen gives it.',
      'Refused (PLAN-SHOWN): scenario a, expect 1.1, names "Gone", which no screen of shop showed in this session. Do the step with the browser tools and copy the text as the screen gives it.',
      "Refused (PLAN-READ): scenario b cites shop, and you have read nothing of it. Call shop_goto first.",
      'Refused (PLAN-SHOWN): scenario b, expect 1.1, names "Orders", which no screen of shop showed in this session. Do the step with the browser tools and copy the text as the screen gives it.',
      "Refused (PLAN-READ): scenario c cites shop, and you have read nothing of it. Call shop_goto first.",
      'Refused (PLAN-SHOWN): scenario c, expect 1.1, names "Orders", which no screen of shop showed in this session. Do the step with the browser tools and copy the text as the screen gives it.',
      "Nothing else was refused.",
    ]);
    await search!.execute({});
    await act(screens, "goto");
    await act(screens, "fill");
    const fixed = (shows: string[]) => ({
      scenarios: [
        {
          ...submitted.scenarios[0]!,
          sources: [{ source: "orders-db" }, { source: "shop" }, { source: "specs" }],
          data: [...data.slice(0, 4), { value: "ORD-1042", from: "orders-db" }],
          steps: [{ action: "Search zzqx", expects: [{ result: "Nothing matches", shows, absent: ["ORD-1057", "Lena"] }] }],
        },
        scenario("b"),
        scenario("c"),
      ],
    });
    // A text the base gave, and no screen of the application: a test could not find it as the screen gives it.
    assert.deepEqual(await submit(made, fixed(["Mira Veldane", "zzqx", "Orders"])), {
      error:
        'Refused (PLAN-SHOWN): scenario a, expect 1.1, names "Mira Veldane", which no screen of shop showed in this session. Do the step with the browser tools and copy the text as the screen gives it.\nNothing else was refused.',
    });
    // The values of the data of a source, spaces and case aside; a source without any tool is held to nothing.
    assert.equal(await submit(made, fixed(["orders", "zzqx", "Orders"])), "The plan was accepted.\n\nScenario 1.");
  });

  it("refuse a made-up value a screen or a source showed before it was typed, a text expected gone only a field showed, and a nominal scenario that expects gone the value it typed", async () => {
    const { proposal: made, screens, reads } = await proposal();
    await reads.tools()[0]!.execute({});
    await act(screens, "fill");
    await act(screens, "fill", { value: "Lena Brook" });
    await act(screens, "click");
    const searched = (changes: Partial<PlannedScenario>) =>
      scenario("a", {
        kind: "functional",
        steps: [{ action: "Search zzqx", expects: [{ result: "The order of Mira Veldane shows", shows: ["ORD-1042"], absent: ["zzqx"] }] }],
        ...changes,
      });
    const data = [
      { value: "Lena Brook", from: "made-up" },
      { value: "Mira Veldane", from: "made-up" },
      { value: "Long Long", from: "made-up" },
      { value: "zzqx", from: "made-up" },
    ];
    const lena = (steps: PlannedScenario["steps"]) => scenario("b", { kind: "functional", data: [{ value: "Lena Brook", from: "shop" }], steps });
    const cancelled = { action: "Cancel the order of Lena Brook", expects: [{ result: "Its order goes", shows: [], absent: ["Lena Brook"] }] };
    const negative = scenario("c", {
      kind: "functional",
      case: "negative",
      steps: [{ action: "Search zzqx", expects: [{ result: "Another order shows", shows: ["ORD-1042"], absent: [] }] }],
    });
    assert.deepEqual(((await submit(made, { scenarios: [searched({ data }), lena([cancelled]), negative] })) as { error: string }).error.split("\n"), [
      'Refused (PLAN-MADE-UP): scenario a gives "Lena Brook" as made-up, and shop showed it before you typed it: the test does not invent it. Give its source instead: { "value": "Lena Brook", "from": "shop" }.',
      'Refused (PLAN-MADE-UP): scenario a gives "Mira Veldane" as made-up, and shop showed it before you typed it: the test does not invent it. Give its source instead: { "value": "Mira Veldane", "from": "shop" }.',
      'Refused (PLAN-MADE-UP): scenario a gives "Long Long" as made-up, and orders-db showed it before you typed it: the test does not invent it. Give its source instead: { "value": "Long Long", "from": "orders-db" }.',
      'Refused (PLAN-SHOWN): scenario a, expect 1.1, names in absent "zzqx", which the screens of shop showed only in a field: the field keeps what you typed whatever the application answers. Put in absent a text the action removed, such as a row the search filtered out.',
      'Refused (PLAN-NOMINAL): scenario b is nominal: its data is what it finds, and "Lena Brook" in absent of expect 1.1 says it finds nothing. Put it in shows, or make the scenario negative; if a step removes it, put it in shows of the step before that makes or finds it. If the screens found nothing with "Lena Brook", try a part of it, such as a first or a last name, with the browser tools.',
      "Nothing else was refused.",
    ]);
    // A value a step before shows is removed, not searched in vain; an application without a user interface is held to none of its screens.
    const found = { action: "Find the order of Lena Brook", expects: [{ result: "Its order shows", shows: ["Lena Brook"], absent: [] }] };
    const ledger = scenario("c", {
      application: "ledger",
      data: [{ value: "Quill", from: "made-up" }],
      steps: [{ action: "Search Quill", expects: [{ result: "Quill is echoed", shows: ["Quill"], absent: ["Quill"] }] }],
    });
    const fixed = searched({
      case: "negative",
      data: [
        { value: "Mira Veldane", from: "shop" },
        { value: "Long Long", from: "orders-db" },
        { value: "zzqx", from: "made-up" },
      ],
      steps: [{ action: "Search zzqx", expects: [{ result: "Another order shows", shows: ["ORD-1042"], absent: ["ORD-1057"] }] }],
    });
    assert.equal(await submit(made, { scenarios: [fixed, lena([found, cancelled]), ledger] }), "The plan was accepted.\n\nScenario 1.");
  });

  it("take a made-up value a source returned once a field held it: the test made it", async () => {
    const { proposal: made, screens, reads } = await proposal();
    await act(screens, "fill", { value: "Long Long" });
    await reads.tools()[0]!.execute({});
    const saved = scenario("a", { data: [{ value: "Long Long", from: "made-up" }] });
    assert.equal(await submit(made, { scenarios: [saved, scenario("b"), scenario("c")] }), "The plan was accepted.\n\nScenario 1.");
  });

  it("give the last texts of a source as what they would accept of a value it never showed", async () => {
    const { proposal: made, reads } = await proposal();
    await reads.tools()[0]!.execute({});
    const wrong = {
      scenarios: [scenario("a", { sources: [{ source: "orders-db" }], data: [{ value: "Veldano", from: "orders-db" }] }), scenario("b"), scenario("c")],
    };
    for (let at = 0; at < 2; at += 1) await submit(made, wrong);
    assert.equal(
      ((await submit(made, wrong)) as { error: string }).error,
      `Third refusal for the same reason. Do only this:\nRead "Veldano" with orders_db_search, or take a value orders-db showed you last:\n- ORD-1042\n- Mira Veldane\n- 7\n- ${"Long ".repeat(40)}…`,
    );
  });
});
