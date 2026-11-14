import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlanReview, TestPlan, ToolDefinition } from "@open-qa-stack/domain";
import { Journal } from "../src/common/journal.ts";
import { PlanProposal, type PlanRules, type SubmittedPlan, type SubmittedScenario, type SubmittedStep } from "../src/designer/plan-proposal.ts";
import { ScreenWatch, type TargetMatcher } from "../src/designer/screen-watch.ts";
import { SourceWatch } from "../src/designer/source-watch.ts";

/** A step as these tests write it: it cites the first action, which opened the orders, unless it cites others. */
type Step = Omit<SubmittedStep, "actions"> & { readonly actions?: readonly number[] };
/** A scenario as these tests write it. */
type Scenario = Omit<SubmittedScenario, "steps"> & { readonly steps: readonly Step[] };
/** A plan as these tests write it. */
interface Plan {
  readonly scenarios: readonly Scenario[];
  readonly accepts?: readonly number[];
  readonly uncovered?: readonly { readonly asked: string; readonly reason: string }[];
}
/** The line of code the tool that opens the orders returns. */
const OPENED = 'await page.goto("/orders");';
/** The element the orders page shows its heading in. */
const HEADING = { text: "Orders", locator: 'page.getByRole("heading", { name: "Orders", exact: true })', field: false };
/** The line of code the tool that clicks returns. */
const CLICKED = 'await page.getByRole("button", { name: "Search", exact: true }).click();';

const scenario = (id: string, changes: Partial<Scenario> = {}): Scenario => ({
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
const plan = (...ids: string[]): Plan => ({ scenarios: ids.map((id) => scenario(id)) });

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
    tool("goto", () => ({ url: "/orders", code: OPENED })),
    tool("snapshot", () => ({ page, truncated: false })),
    tool("click", () => {
      page = '- heading "Orders"\n- row "ORD-1042 Mira Veldane"';
      return { code: CLICKED };
    }),
    tool("fill", ({ value = "zzqx" }) => {
      page = `${page}\n- textbox "Search orders": ${value} → page.getByRole("textbox", { name: "Search orders", exact: true })`;
      return { code: `await page.getByRole("textbox", { name: "Search orders", exact: true }).fill(${JSON.stringify(value)});` };
    }),
    tool("select_option", () => ({ code: 'await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("Paid");' })),
    tool("check", () => ({ code: 'await page.getByRole("checkbox", { name: "Paid", exact: true }).check();' })),
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

/** What a plan of the shop is checked against, but what the agent saw and read. */
const RULES: Omit<PlanRules, "screens" | "reads"> = {
  sources: ["shop", "orders-db", "guide", "specs"],
  applications: ["shop", "ledger"],
  domains: ["orders"],
  secrets: [],
  addresses: ["http://127.0.0.1:8090"],
  review: { review: async () => ({ accepted: true }) },
};

/** What the gates say of the scenarios of the shop when nothing was done on its screens. */
const UNEXPLORED = (scenarios: string) =>
  `you did nothing on the screens of shop in this session, and ${scenarios} about it: the harness writes the code of each step from the actions that did it. Open the first address of each scenario with shop_goto, do its steps with the browser tools, then give in actions of each step the numbers their results return in "action", such as "actions": [1, 2] for a step done by the actions 1 and 2.`;
/** What the agent is told of a plan accepted from which the harness took nothing out. */
const ACCEPTED = "The plan was accepted.\nNext: answer with one sentence. Call no more tools.";

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
  const rules: PlanRules = { ...RULES, screens, reads, ...changes };
  return { proposal: new PlanProposal(rules, journal), screens, reads, journal };
}

/** A review that answers once both plans were submitted, so that the two are reviewed at once. */
function slowReview(decision: (plan: TestPlan) => boolean): PlanReview {
  return {
    review: async (submitted) =>
      new Promise((resolve) => setTimeout(() => resolve(decision(submitted) ? { accepted: true } : { accepted: false, reason: "Not this one." }), 20)),
  };
}

/** The plan as the agent submits it: each step cites the first action when the test names none. */
const cited = (submitted: Plan): SubmittedPlan => ({
  ...submitted,
  scenarios: submitted.scenarios.map((planned) => ({ ...planned, steps: planned.steps.map((step) => ({ actions: [1], ...step })) })),
});
const submit = (proposal: PlanProposal, submitted: Plan) => proposal.tool().execute(cited(submitted)) as Promise<string | { error: string }>;
const act = (screens: ScreenWatch, action: string, args: object = {}) =>
  screens
    .tools()
    .find((tool) => tool.name === `shop_${action}`)!
    .execute(args);

describe("plans reviewed at once", () => {
  it("keep the first one accepted, and refuse the other", async () => {
    const { proposal: made, journal } = await proposal({ review: slowReview(() => true) });
    const [first, second] = await Promise.all([submit(made, plan("a", "b", "c")), submit(made, plan("x", "y", "z"))]);
    assert.equal(first, ACCEPTED);
    assert.deepEqual(second, { error: "The plan is accepted, and this session is over. Answer with one sentence; call no more tools." });
    // The plan kept holds what the harness wrote: the code of the action each step cites, and the element of each text a screen showed in one.
    const step = { action: "Open the orders", code: [OPENED], expects: [{ result: "The orders show", shows: ["Orders"], absent: [], elements: [HEADING] }] };
    assert.deepEqual(made.accepted, { scenarios: ["a", "b", "c"].map((id) => ({ ...scenario(id), steps: [step] })) });
    assert.equal(journal.entries().filter((entry) => entry.message.startsWith("The plan was accepted")).length, 1);
    // Once a plan is accepted, the session that plans is over: another is refused before it is read.
    assert.deepEqual(await submit(made, plan("x", "y", "z")), { error: made.closed() });
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
  const functional = (id: string, changes: Partial<Scenario> = {}) =>
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

  it("take what the page shows once an address is opened as the result of that action", async () => {
    const { proposal: made } = await proposal();
    // The only action is the address opened: a scenario that expects what the page then shows expects a result.
    const opened = functional("a", {
      data: [],
      steps: [{ action: "Open the orders", actions: [1], expects: [{ result: "The orders show", shows: ["Orders"], absent: [] }] }],
    });
    assert.equal(await submit(made, { scenarios: [opened, scenario("b"), scenario("c")] }), ACCEPTED);
  });

  it("refuse a functional scenario whose texts no action of the agent made appear or go, until one did", async () => {
    const { proposal: made, screens } = await proposal();
    const submitted = {
      scenarios: [
        functional("a"),
        functional("b", {
          case: "negative",
          data: [{ value: "zzqx", from: "made-up" }],
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
      /after an action of yours on shop\. Do its steps with shop_goto, shop_fill and shop_click, read what the page shows once opened and what each result says appeared and went, and expect that\./,
    );
    await act(screens, "click");
    assert.equal(await submit(made, submitted), ACCEPTED);
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
    assert.equal(await submit(made, submitted), ACCEPTED);
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

  it("refuse an expected text that holds an address of the configuration, which no test may hold", async () => {
    const { proposal: made } = await proposal();
    const footer = "BACKEND: http://127.0.0.1:8090";
    const steps = [{ action: "Open the orders", expects: [{ result: "The orders show", shows: ["Orders"], absent: [footer] }] }];
    const refused = (await submit(made, { scenarios: [scenario("a", { steps }), scenario("b"), scenario("c")] })) as { error: string };
    assert.equal(
      refused.error.split("\n")[0],
      `Refused (PLAN-ADDRESS): scenario a, expect 1.1, names "${footer}", which holds http://127.0.0.1:8090, an address of the configuration: no test may hold a host. Leave this text out, and expect another text the screen showed after the step, such as a heading, a row or a message.`,
    );
  });

  it("keep what the agent says the brief asks and the application does not allow, and say it in the journal", async () => {
    const { proposal: made, journal } = await proposal();
    const uncovered = [{ asked: "Change the address of a customer.", reason: "No screen of shop offers to edit an address." }];
    assert.equal(await submit(made, { ...plan("a", "b", "c"), uncovered }), ACCEPTED);
    assert.deepEqual(made.accepted!.uncovered, uncovered);
    assert.deepEqual(
      journal.entries().filter((entry) => entry.level === "error"),
      [
        {
          level: "error",
          message: "The plan does not cover what the brief asks: Change the address of a customer. No screen of shop offers to edit an address.",
        },
      ],
    );
    // A plan that covers the brief says nothing of it, with or without an empty list.
    for (const covered of [{}, { uncovered: [] }]) {
      const { proposal: whole } = await proposal();
      assert.equal(await submit(whole, { ...plan("a", "b", "c"), ...covered }), ACCEPTED);
      assert.equal("uncovered" in whole.accepted!, false);
    }
    // What it says holds no secret either.
    const { proposal: secret } = await proposal({ secrets: [{ variable: "SHOP_PASSWORD", value: "s3cret-pass" }] });
    const told = (await submit(secret, { ...plan("a", "b", "c"), uncovered: [{ asked: "Sign in.", reason: "The password s3cret-pass is refused." }] })) as {
      error: string;
    };
    assert.match(told.error, /^Refused \(PLAN-SECRET\): the plan holds the value of SHOP_PASSWORD\./);
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
      `Third refusal for the same reason. Do this:\n${idError}`,
      `Fourth refusal for the same reason. Do this:\n${idError}`,
      `Fifth refusal for the same reason. Do this:\n${idError}`,
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
        action: "Search for zzqx",
        expects: [{ result: "Nothing matches", shows: ["No order matches zzqx", "zzqx", "Orders"], absent: ["ORD-1057", "Lena", "Gone"] }],
      },
    ];
    const submitted = {
      scenarios: [
        scenario("a", { sources: [{ source: "orders-db" }, { source: "guide" }, { source: "shop" }, { source: "shop" }, { source: "specs" }], data, steps }),
        scenario("b"),
        scenario("c", { steps: [{ action: "Go to the orders page", expects: [{ result: "The orders show", shows: ["Orders"], absent: [] }] }] }),
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
      'Refused (PLAN-SHOWN): scenario a, expect 1.1, names "No order matches zzqx", which no screen of shop showed in this session. Do step 1, "Search for zzqx", with shop_fill, then copy a text that appeared after it, as the screen gives it.',
      'Refused (PLAN-SHOWN): scenario a, expect 1.1, names "zzqx", a value of its data that no field of shop held in this session. Type it with shop_fill and do the step, then expect what the screen answered: the field only echoes the value.',
      'Refused (PLAN-SHOWN): scenario a, expect 1.1, names "Orders", which no screen of shop showed in this session. Do step 1, "Search for zzqx", with shop_fill, then copy a text that appeared after it, as the screen gives it.',
      'Refused (PLAN-SHOWN): scenario a, expect 1.1, names "ORD-1057", which no screen of shop showed in this session. Do step 1, "Search for zzqx", with shop_fill, then copy a text that went after it, as the screen gives it.',
      'Refused (PLAN-SHOWN): scenario a, expect 1.1, names "Lena", which no screen of shop showed in this session. Do step 1, "Search for zzqx", with shop_fill, then copy a text that went after it, as the screen gives it.',
      'Refused (PLAN-SHOWN): scenario a, expect 1.1, names "Gone", which no screen of shop showed in this session. Do step 1, "Search for zzqx", with shop_fill, then copy a text that went after it, as the screen gives it.',
      "Refused (PLAN-READ): scenario b cites shop, and you have read nothing of it. Call shop_goto first.",
      'Refused (PLAN-SHOWN): scenario b, expect 1.1, names "Orders", which no screen of shop showed in this session. Do step 1, "Open the orders", with shop_click, then copy a text that appeared after it, as the screen gives it.',
      "Refused (PLAN-READ): scenario c cites shop, and you have read nothing of it. Call shop_goto first.",
      'Refused (PLAN-SHOWN): scenario c, expect 1.1, names "Orders", which no screen of shop showed in this session. Do step 1, "Go to the orders page", with shop_goto, then copy a text that appeared after it, as the screen gives it.',
      // Nothing was done on the shop: one message says so, whatever the number of the steps.
      `Refused (PLAN-LOCATOR): ${UNEXPLORED("the scenarios a, b, c are")}`,
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
        'Refused (PLAN-SHOWN): scenario a, expect 1.1, names "Mira Veldane", which no screen of shop showed in this session. Do step 1, "Search zzqx", with the browser tools, then copy a text that appeared after it, as the screen gives it.\nNothing else was refused.',
    });
    // The values of the data of a source, spaces and case aside; a source without any tool is held to nothing.
    assert.equal(await submit(made, fixed(["orders", "zzqx", "Orders"])), ACCEPTED);
  });

  it("refuse a made-up value a screen or a source showed before it was typed, a text expected gone only a field showed, and a nominal scenario that expects gone the value it typed", async () => {
    const { proposal: made, screens, reads } = await proposal();
    await reads.tools()[0]!.execute({});
    await act(screens, "fill");
    await act(screens, "fill", { value: "Lena Brook" });
    await act(screens, "click");
    const searched = (changes: Partial<Scenario>) =>
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
    const lena = (steps: Scenario["steps"]) => scenario("b", { kind: "functional", data: [{ value: "Lena Brook", from: "shop" }], steps });
    const cancelled = { action: "Cancel the order of Lena Brook", expects: [{ result: "Its order goes", shows: [], absent: ["Lena Brook"] }] };
    const negative = scenario("c", {
      kind: "functional",
      case: "negative",
      data: [{ value: "zzqx", from: "made-up" }],
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
    assert.equal(await submit(made, { scenarios: [fixed, lena([found, cancelled]), ledger] }), ACCEPTED);
  });

  it("refuse a step that types in a scenario without data, and a text only the name of a field or a value typed in it showed", async () => {
    const { proposal: made, screens, reads } = await proposal();
    await reads.tools()[0]!.execute({});
    await act(screens, "fill", { value: "Lena" });
    await act(screens, "click");
    const search = (action: string, shows: string[]) => [{ action, expects: [{ result: "The search answers", shows, absent: [] }] }];
    const submitted = (data: Scenario["data"], shows: string[]) => ({
      scenarios: [
        functional("a", { data, steps: search("Enter Lena in the search field", shows) }),
        // A negative scenario that types nothing, such as one that submits an empty search, needs no data.
        functional("b", { case: "negative", steps: search("Press Enter in the empty search field", ["ORD-1042"]) }),
        functional("c", { application: "ledger", case: "negative", steps: search("Search for Lena", ["ORD-1042"]) }),
      ],
    });
    assert.deepEqual(((await submit(made, submitted([], ["Search orders", "Lena", "ORD-1042"]))) as { error: string }).error.split("\n"), [
      'Refused (PLAN-INPUT): scenario a, step 1, "Enter Lena in the search field", types a value, and the scenario has no data: its test may type only values of its data. Put the value the step types in data, with from "shop" for one a screen of shop showed, or from "made-up" for one the test invents, such as { "value": "zqxw", "from": "made-up" }. A step that types nothing, such as one that leaves a field empty, says what it clicks instead.',
      'Refused (PLAN-INPUT): scenario a, expect 1.1, names "Search orders", which the screens of shop showed only as the name of a field: no text of the page holds it, and a test finds the field by it. Put in shows a text the screens showed beside the fields, such as a heading, a row or a count of results.',
      "Nothing else was refused.",
    ]);
    // A value of the data the agent typed and the screens showed nowhere else is an echo of the field.
    assert.deepEqual((await submit(made, submitted([{ value: "Lena", from: "shop" }], ["ORD-1042"]))) as string, ACCEPTED);
  });

  it("refuse a value typed in a field as what a scenario expects, or as a value of the data the application gave, and keep one a field held untyped", async () => {
    const { proposal: made, screens } = await proposal();
    await act(screens, "fill", { value: "Quill Zed" });
    await act(screens, "click");
    // A field the application fills, such as one of a form to edit, holds what it gave.
    await act(screens, "fill");
    const echoed = (value: string) => ({
      scenarios: [
        functional("a", {
          data: [{ value, from: "shop" }],
          steps: [{ action: `Search ${value}`, expects: [{ result: "The search answers", shows: [value, "ORD-1042"], absent: [] }] }],
        }),
        scenario("b"),
        scenario("c"),
      ],
    });
    assert.deepEqual(((await submit(made, echoed("Quill Zed"))) as { error: string }).error.split("\n"), [
      'Refused (PLAN-INPUT): scenario a, expect 1.1, names "Quill Zed", which the screens of shop showed only in a field you typed it in: the field echoes what the test types, whatever the application answers. Put in shows what the application answered beside the fields, such as a row, a message or a count of results.',
      'Refused (PLAN-DATA): no result of shop showed "Quill Zed" in this session. Read it first with shop_goto, or correct the value. A value the test invents has from "made-up".',
      "Nothing else was refused.",
    ]);
    assert.equal(screens.onlyInFields("shop", "zzqx"), "value");
    assert.equal(screens.onlyInFields("ledger", "zzqx"), undefined);
    assert.equal(screens.showsUntyped("ledger", "zzqx"), false);
    assert.equal(await submit(made, echoed("zzqx")), ACCEPTED);
  });

  it("tell to type a value of the data that no field held, with the last line of code that filled a field, from the third refusal", async () => {
    const filled = 'await page.getByRole("textbox", { name: "Search orders", exact: true }).fill("Lena");';
    const coded = (tool: ToolDefinition, code: string): ToolDefinition => ({
      ...tool,
      execute: async (args) => ({ ...((await tool.execute(args)) as object), code }),
    });
    const tools = shopTools().map((tool) =>
      tool.name === "shop_fill" ? coded(tool, filled) : tool.name === "shop_goto" ? coded(tool, 'await page.goto("/orders");') : tool,
    );
    const typed = new ScreenWatch(["shop"], tools);
    for (const action of ["goto", "fill", "click"]) await act(typed, action, { value: "Lena" });
    const echoed = {
      scenarios: [
        functional("a", {
          case: "negative",
          data: [{ value: "Quill Zed", from: "made-up" }],
          steps: [{ action: "Search Quill Zed", expects: [{ result: "The search answers", shows: ["Quill Zed", "ORD-1042"], absent: [] }] }],
        }),
        scenario("b"),
        scenario("c"),
      ],
    };
    const told = async (screens: ScreenWatch) => {
      const { proposal: made } = await proposal({ screens });
      const errors = [];
      for (let at = 0; at < 3; at += 1) errors.push(((await submit(made, echoed)) as { error: string }).error);
      return errors;
    };
    const [first, , third] = await told(typed);
    assert.equal(
      first,
      'Refused (PLAN-SHOWN): scenario a, expect 1.1, names "Quill Zed", a value of its data that no field of shop held in this session. Type it with shop_fill and do the step, then expect what the screen answered: the field only echoes the value.\nNothing else was refused.',
    );
    const remedy =
      'Type "Quill Zed" with shop_fill and do the step, then put in shows what the screen answered after it, such as a message or a count of results.';
    assert.equal(third, `Third refusal for the same reason. Do this:\n${remedy}\nThe last line of code that filled a field, with another value: ${filled}`);
    // Without a line of code that filled a field, the remedy gives none.
    const silent = shopTools().map((tool) => (tool.name === "shop_fill" ? { ...tool, execute: async () => ({}) } : tool));
    const plain = new ScreenWatch(["shop"], silent);
    for (const action of ["goto", "fill", "click"]) await act(plain, action);
    assert.equal((await told(plain))[2], `Third refusal for the same reason. Do this:\n${remedy}`);
  });

  it("take out the echo of a value a step only types before another step, and keep every other text", async () => {
    const { proposal: made, screens, journal } = await proposal();
    await act(screens, "click");
    const typed = (text: string) => ({ result: "The field holds it", shows: [text], absent: [] });
    const answered = { action: "Click Search", expects: [{ result: "The order shows", shows: ["ORD-1042"], absent: [] }] };
    // The value invents a customer no field ever held: the echo is the only text no screen showed.
    const negative = functional("a", {
      case: "negative",
      data: [{ value: "Quill Zed", from: "made-up" }],
      steps: [{ action: "Enter 'Quill Zed' in the search field", expects: [typed("Quill Zed"), { ...typed("quill  zed"), absent: ["ORD-1057"] }] }, answered],
    });
    // A row showed the value beside the fields: the step expects what the application answered.
    const nominal = functional("b", {
      data: [{ value: "Lena Brook", from: "shop" }],
      steps: [{ action: "Type Lena Brook in the search field", expects: [{ ...typed("Lena Brook"), shows: ["Lena Brook", "Orders"] }] }, answered],
    });
    // A step that also sends the form, and the last step, keep what they show: the application may answer with the value.
    const sent = functional("c", {
      data: [{ value: "Quill Zed", from: "made-up" }],
      steps: [
        { action: "Enter Quill Zed and click Search", expects: [typed("Quill Zed")] },
        { action: "Search for Quill Zed", expects: [typed("Quill Zed")] },
      ],
    });
    // The gates number the expects as the agent wrote them, the one emptied of its echo included, and pass it over.
    const unseen = functional("d", {
      case: "negative",
      data: [{ value: "Quill Zed", from: "made-up" }],
      steps: [{ action: "Enter 'Quill Zed' in the search field", expects: [typed("Quill Zed"), typed("Unseen text")] }, answered],
    });
    assert.deepEqual(await submit(made, { scenarios: [unseen, sent] }), {
      error: [
        "Refused (PLAN-RESULT): no text scenario c expects appeared, or went, after an action of yours on shop. Do its steps with shop_goto, shop_fill and shop_click, read what the page shows once opened and what each result says appeared and went, and expect that.",
        'Refused (PLAN-SHOWN): scenario d, expect 1.2, names "Unseen text", which no screen of shop showed in this session. Do step 1, "Enter \'Quill Zed\' in the search field", with shop_fill, then copy a text that appeared after it, as the screen gives it.',
        'Refused (PLAN-SHOWN): scenario c, expect 1.1, names "Quill Zed", a value of its data that no field of shop held in this session. Type it with shop_fill and do the step, then expect what the screen answered: the field only echoes the value.',
        'Refused (PLAN-SHOWN): scenario c, expect 2.1, names "Quill Zed", a value of its data that no field of shop held in this session. Type it with shop_fill and do the step, then expect what the screen answered: the field only echoes the value.',
        "Nothing else was refused.",
      ].join("\n"),
    });
    // The agent is told what the harness took out of its plan.
    assert.equal(
      await submit(made, { scenarios: [negative, nominal] }),
      [
        "The plan was accepted.",
        'The harness took "Quill Zed" out of expect 1.1 of scenario a: the field echoes what the step types.',
        'The harness took "quill  zed" out of expect 1.2 of scenario a: the field echoes what the step types.',
        "Next: answer with one sentence. Call no more tools.",
      ].join("\n"),
    );
    assert.deepEqual(
      made.accepted!.scenarios.map((kept) => kept.steps.map((step) => step.expects.map((expect) => [expect.shows, expect.absent]))),
      [
        [[[[], ["ORD-1057"]]], [[["ORD-1042"], []]]],
        [[[["Lena Brook", "Orders"], []]], [[["ORD-1042"], []]]],
      ],
    );
    assert.deepEqual(
      journal
        .entries()
        .filter((entry) => entry.level === "info")
        .map((entry) => entry.message),
      [
        'The harness took "Quill Zed" out of expect 1.1 of scenario a: the field echoes what the step types.',
        'The harness took "quill  zed" out of expect 1.2 of scenario a: the field echoes what the step types.',
        "The plan was accepted: a, b.",
      ],
    );
  });

  it("refuse a nominal scenario that types a value the screens searched in vain", async () => {
    let shown = '- heading "Orders"\n- row "ORD-1057 Lena Brook"';
    const tool = (action: string, execute: (args: { value?: string }) => void): ToolDefinition => ({
      name: `shop_${action}`,
      description: action,
      parameters: { type: "object" },
      execute: async (args) =>
        action === "snapshot" ? { page: shown, truncated: false } : (execute(args as { value?: string }), action === "goto" ? { code: OPENED } : {}),
    });
    const field = (value: string) => `- textbox "Search orders": ${value}`;
    const screens = new ScreenWatch(
      ["shop"],
      [
        tool("goto", () => undefined),
        tool("snapshot", () => undefined),
        tool("fill", ({ value = "" }) => (shown = `${shown}\n${field(value)}`)),
        tool("click", () => (shown = `- heading "Orders"\n${field("Lena Brook")}\n- columnheader "0 of 0"`)),
        tool("select_option", () => undefined),
        tool("check", () => undefined),
      ],
    );
    const { proposal: made } = await proposal({ screens });
    await act(screens, "goto");
    await act(screens, "fill", { value: "Lena Brook" });
    await act(screens, "click");
    const searched = (id: string, kind: Scenario["case"]) =>
      functional(id, {
        case: kind,
        data: [{ value: "Lena Brook", from: "shop" }],
        steps: [{ action: "Search for Lena Brook", expects: [{ result: "Nothing is found", shows: ["0 of 0"], absent: [] }] }],
      });
    // A scenario that types nothing has nothing to search, whatever its data.
    const opened = scenario("c", { data: [{ value: "Lena Brook", from: "shop" }] });
    // A scenario types the values its steps name: the part it searched, not the name of the row it opens.
    const part = functional("d", {
      data: [
        { value: "Brook", from: "shop" },
        { value: "Lena Brook", from: "shop" },
      ],
      steps: [
        { action: "Search for Brook", expects: [{ result: "The orders show", shows: ["0 of 0"], absent: [] }] },
        { action: "Open the order of Lena Brook", expects: [{ result: "The order shows", shows: ["Orders"], absent: [] }] },
      ],
    });
    // A step that names no value types any value a field held.
    const unnamed = functional("e", {
      data: [{ value: "Lena Brook", from: "shop" }],
      steps: [{ action: "Type the name in the search field", expects: [{ result: "Nothing is found", shows: ["0 of 0"], absent: [] }] }],
    });
    const refused = (id: string) =>
      `Refused (PLAN-NOMINAL): scenario ${id} is nominal, and the screens of shop found nothing with "Lena Brook": a nominal scenario finds what it searches. Replace "Lena Brook" in data, and in the step that types it, by a part of it, such as a first or a last name, that you searched with shop_fill and found, and expect what it found; or make the scenario negative.`;
    const remedy = (id: string) =>
      `Replace "Lena Brook" in data of scenario ${id}, and in the step that types it, by a part of it that shop_fill found, such as a first or a last name; or make scenario ${id} negative.`;
    const submitted = { scenarios: [searched("a", "nominal"), searched("b", "negative"), opened, part, unnamed] };
    assert.deepEqual(await submit(made, submitted), { error: [refused("a"), refused("e"), "Nothing else was refused."].join("\n") });
    await submit(made, submitted);
    assert.deepEqual(await submit(made, submitted), { error: ["Third refusal for the same reason. Do this:", remedy("a"), remedy("e")].join("\n") });
    assert.equal(await submit(made, { scenarios: [searched("a", "negative"), searched("b", "negative"), opened] }), ACCEPTED);
  });

  it("take a made-up value a source returned once a field held it: the test made it", async () => {
    const { proposal: made, screens, reads } = await proposal();
    await act(screens, "fill", { value: "Long Long" });
    await reads.tools()[0]!.execute({});
    const saved = scenario("a", { data: [{ value: "Long Long", from: "made-up" }] });
    assert.equal(await submit(made, { scenarios: [saved, scenario("b"), scenario("c")] }), ACCEPTED);
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
      `Third refusal for the same reason. Do this:\nRead "Veldano" with orders_db_search, or take a value orders-db showed you last:\n- ORD-1042\n- Mira Veldane\n- 7\n- ${"Long ".repeat(40)}…`,
    );
  });
});

describe("the actions a plan cites", () => {
  const FILLED = (value: string) => `await page.getByRole("textbox", { name: "Search orders", exact: true }).fill(${JSON.stringify(value)});`;
  const shown = (text: string) => ({ result: "The orders show", shows: [text], absent: [] });
  /** The screens of the shop and of a desk, another application with a user interface. */
  const twoApplications = () =>
    new ScreenWatch(["shop", "desk"], [...shopTools(), ...shopTools().map((tool) => ({ ...tool, name: tool.name.replace("shop_", "desk_") }))]);

  it("are told to the agent by the tool: the numbers the browser tools returned, in order", () => {
    const { parameters, description } = new PlanProposal(
      { ...RULES, screens: new ScreenWatch([], []), reads: new SourceWatch([], [], []) },
      new Journal(),
    ).tool();
    const step = (
      parameters as { properties: { scenarios: { items: { properties: { steps: { items: { required: string[]; properties: Record<string, unknown> } } } } } } }
    ).properties.scenarios.items.properties.steps.items;
    assert.deepEqual(step.required, ["action", "actions", "expects"]);
    assert.deepEqual(step.properties["actions"], {
      type: "array",
      maxItems: 12,
      items: { type: "integer", minimum: 1 },
      description:
        'The numbers of the actions that did this step when you explored, in the order a test does them, as the results of the browser tools gave them in "action", such as [3, 4] for a step done by the actions 3 and 4. The first action of a scenario opens an address; scenarios may cite the same actions, such as those that sign in. Empty for an application without screens.',
    });
    assert.match(description, /A step has one action, in actions the numbers of the browser actions that did it when you explored, and 0 to 4 expects;/);
    assert.match(
      description,
      /the harness writes their code and their locators from the actions you cite and the screens you saw; you never write a locator\./,
    );
  });

  it("are refused when a step cites none, one no tool returned, or one done on another application, with the last actions as what they would accept", async () => {
    const screens = twoApplications();
    const { proposal: made } = await proposal({ screens, applications: ["shop", "desk"] }, false);
    const act = (name: string, args: object = {}) =>
      screens
        .tools()
        .find((tool) => tool.name === name)!
        .execute(args);
    const submitted = {
      scenarios: [
        scenario("a", { steps: [{ action: "Open the orders", actions: [], expects: [shown("Orders")] }] }),
        scenario("b", { steps: [{ action: "Open the orders", actions: [1, 7], expects: [shown("Orders")] }] }),
        scenario("c", { steps: [{ action: "Open the orders", actions: [2], expects: [shown("Orders")] }] }),
      ],
    };
    // Before any action on the shop, one message says so, in place of one for each step.
    await act("desk_goto");
    await act("shop_snapshot");
    assert.deepEqual(await submit(made, submitted), { error: `Refused (PLAN-LOCATOR): ${UNEXPLORED("the scenarios a, b, c are")}\nNothing else was refused.` });
    const one = { ...submitted, scenarios: [submitted.scenarios[0]!, scenario("b", { application: "ledger" }), scenario("c", { application: "ledger" })] };
    assert.deepEqual(await submit(made, one), { error: `Refused (PLAN-LOCATOR): ${UNEXPLORED("scenario a is")}\nNothing else was refused.` });
    const { proposal: again } = await proposal({ screens, applications: ["shop", "desk"] }, false);
    assert.deepEqual(await act("shop_goto"), {
      url: "/orders",
      code: OPENED,
      action: 2,
      page: '- heading "Orders"\n- row "ORD-1057 Lena Brook"',
      truncated: false,
    });
    const refused = (await submit(again, { scenarios: [submitted.scenarios[0]!, submitted.scenarios[1]!, scenario("c")] })) as { error: string };
    assert.deepEqual(refused.error.split("\n"), [
      'Refused (PLAN-LOCATOR): scenario a, step 1, "Open the orders", cites no action: the harness writes the code of a step from the actions that did it. Do the step with the browser tools of shop, such as shop_click, then give in actions the numbers their results return in "action", such as "actions": [3, 4] for a step done by the actions 3 and 4.',
      'Refused (PLAN-LOCATOR): scenario b, step 1, "Open the orders", cites the action 1, done on desk: a test of shop acts on shop alone. Do the step with the browser tools of shop, such as shop_click, and cite the numbers their results return in "action".',
      'Refused (PLAN-LOCATOR): scenario b, step 1, "Open the orders", cites the action 7, which no browser tool returned in this session. Give in actions the numbers the results of the browser tools of shop return in "action"; do the step again if you no longer have them.',
      'Refused (PLAN-LOCATOR): scenario c, step 1, "Open the orders", cites the action 1, done on desk: a test of shop acts on shop alone. Do the step with the browser tools of shop, such as shop_click, and cite the numbers their results return in "action".',
      "Nothing else was refused.",
    ]);
    await submit(again, submitted);
    assert.equal(
      ((await submit(again, submitted)) as { error: string }).error,
      `Third refusal for the same reason. Do this:\nGive in actions of each step the numbers of the actions that did it. The last actions on shop, each after its number:\n2: ${OPENED}`,
    );
    const fixed = {
      scenarios: ["a", "b", "c"].map((id) => scenario(id, { steps: [{ action: "Open the orders", actions: [2], expects: [shown("Orders")] }] })),
    };
    assert.equal(await submit(again, fixed), ACCEPTED);
  });

  it("start, for each scenario, with one that opens an address: its test starts on an empty page", async () => {
    const { proposal: made, screens } = await proposal({}, false);
    await act(screens, "click");
    const clicked = {
      scenarios: ["a", "b", "c"].map((id) => scenario(id, { steps: [{ action: "Open the orders", actions: [1], expects: [shown("Orders")] }] })),
    };
    const start = (id: string, example: string) =>
      `Refused (PLAN-START): scenario ${id} starts with the action 1 (${CLICKED}), which opens no address, and its test starts on an empty page. Open the first address of the scenario with shop_goto, do its steps from there, and cite that action first in step 1${example}.`;
    assert.deepEqual(await submit(made, clicked), { error: [start("a", ""), start("b", ""), start("c", ""), "Nothing else was refused."].join("\n") });
    await act(screens, "goto");
    const example = `, such as the action 2 (${OPENED})`;
    assert.deepEqual(await submit(made, clicked), {
      error: [start("a", example), start("b", example), start("c", example), "Nothing else was refused."].join("\n"),
    });
    assert.equal(
      ((await submit(made, clicked)) as { error: string }).error,
      [
        "Third refusal for the same reason. Do this:",
        ...["a", "b", "c"].map((id) => `Cite first, in actions of step 1 of scenario ${id}, an action of shop_goto${example}, then the actions done after it.`),
      ].join("\n"),
    );
    const opened = {
      scenarios: ["a", "b", "c"].map((id) => scenario(id, { steps: [{ action: "Open the orders", actions: [2, 1], expects: [shown("Orders")] }] })),
    };
    assert.equal(await submit(made, opened), ACCEPTED);
    assert.deepEqual(made.accepted!.scenarios[0]!.steps[0]!.code, [OPENED, CLICKED]);
  });

  it("typed only values of the data of their scenario, a part of one, nothing, or the credential of an account", async () => {
    const { proposal: made, screens } = await proposal();
    await act(screens, "fill", { value: "Quill Zed" });
    await act(screens, "fill", { value: "Lena" });
    await act(screens, "fill", { value: "" });
    await act(screens, "fill", { value: { account: "demo", field: "username" } });
    await act(screens, "select_option", { option: "Paid" });
    await act(screens, "check", { checked: true });
    const typing = (id: string, data: Scenario["data"]) =>
      scenario(id, { data, steps: [{ action: "Open the orders, then look for an order", actions: [1, 2, 3, 4, 5, 6, 7], expects: [shown("Orders")] }] });
    const refused = (id: string, typed: string) =>
      `Refused (PLAN-INPUT): scenario ${id}, step 1, "Open the orders, then look for an order", cites the action ${typed === '"Quill Zed"' ? 2 : 6}, which typed ${typed}, and ${typed} is no value of the data of the scenario: its test may type only values of its data. Put it in data, with from "shop" for a value a screen of shop showed before you typed it, or from "made-up" for one the test invents, such as { "value": ${typed}, "from": "made-up" }; or do the step again with a value of the data, and cite that action.`;
    const data = [
      { value: "Quill Zed", from: "made-up" },
      { value: "Lena Brook", from: "shop" },
    ];
    assert.deepEqual(await submit(made, { scenarios: [typing("a", data), typing("b", [...data, { value: "Paid", from: "made-up" }]), scenario("c")] }), {
      error: [refused("a", '"Paid"'), "Nothing else was refused."].join("\n"),
    });
    assert.deepEqual(await submit(made, { scenarios: [typing("a", [{ value: "Lena Brook", from: "shop" }]), scenario("b"), scenario("c")] }), {
      error: [refused("a", '"Quill Zed"'), refused("a", '"Paid"'), "Nothing else was refused."].join("\n"),
    });
  });

  it("are written to the plan, whose code may hold the value of no declared variable", async () => {
    const { proposal: made, screens } = await proposal({ secrets: [{ variable: "SHOP_PASSWORD", value: "s3cret-pass" }] });
    await act(screens, "fill", { value: "s3cret-pass" });
    const typed = scenario("a", { data: [], steps: [{ action: "Sign in", actions: [1, 2], expects: [shown("Orders")] }] });
    const refused = (await submit(made, { scenarios: [typed, scenario("b"), scenario("c")] })) as { error: string };
    assert.equal(
      refused.error.split("\n")[0],
      "Refused (PLAN-SECRET): the plan holds the value of SHOP_PASSWORD. Leave it out; a test reads it with process.env.SHOP_PASSWORD.",
    );
    // The credential of an account is typed by its reference, never as a text.
    assert.equal(
      refused.error.split("\n")[1],
      'Refused (PLAN-INPUT): scenario a, step 1, "Sign in", cites the action 2, which typed the value of SHOP_PASSWORD as a text: a test never holds it. Do the step again with shop_fill and the reference of the account in place of the text, such as "value": { "account": "<its name>", "field": "password" }, as the description of shop_fill gives it, then cite that action.',
    );
    assert.ok(!refused.error.includes("s3cret-pass"));
  });

  it("give each step its lines of code, in the order cited, and each expected text the element a screen showed it in, when one did", async () => {
    const { proposal: made, screens, reads } = await proposal();
    await reads.tools()[0]!.execute({});
    await act(screens, "fill", { value: "Veldane" });
    await act(screens, "click");
    const searched = scenario("a", {
      kind: "functional",
      data: [{ value: "Veldane", from: "orders-db" }],
      sources: [{ source: "orders-db" }],
      steps: [
        { action: "Open the orders", actions: [1], expects: [] },
        {
          action: "Search the orders of Veldane, then send",
          actions: [2, 3],
          expects: [{ result: "The order of Mira Veldane shows, the other goes", shows: ["ORD-1042", "Veldane"], absent: ["ORD-1057"] }],
        },
      ],
    });
    // An application without a user interface has no action: those cited are left out, and no element is given.
    const ledger = scenario("b", { application: "ledger", steps: [{ action: "Get the orders", actions: [1, 3], expects: [shown("ORD-1042")] }] });
    assert.equal(await submit(made, { scenarios: [searched, ledger, scenario("c")] }), ACCEPTED);
    const [first, second] = made.accepted!.scenarios;
    assert.deepEqual(first!.steps, [
      { action: "Open the orders", code: [OPENED], expects: [] },
      {
        action: "Search the orders of Veldane, then send",
        code: [FILLED("Veldane"), CLICKED],
        expects: [
          {
            result: "The order of Mira Veldane shows, the other goes",
            shows: ["ORD-1042", "Veldane"],
            absent: ["ORD-1057"],
            // The rows end with no locator and are named by more than the text: their texts are found by themselves. The field that held the
            // value typed is no longer on the screen the step ends on: an element comes from that screen alone.
            elements: [],
          },
        ],
      },
    ]);
    assert.deepEqual(second!.steps, [{ action: "Get the orders", code: [], expects: [{ ...shown("ORD-1042"), elements: [] }] }]);
    assert.ok(!("actions" in first!.steps[0]!));
  });
});

describe("the element of each expected text, as the harness checked its locator on the page", () => {
  const PAGE = [
    '- heading "Orders"',
    '- table "Open orders":',
    '  - row "ORD-1 Active":',
    '    - cell "Active"',
    '  - row "ORD-2 Active":',
    '    - cell "Active"',
    '- cell "Paid"',
    '- cell "Ghost"',
  ].join("\n");
  /** A page with two cells "Active", one alone in the row of ORD-1, three cells "Paid" nothing tells apart, and no cell "Ghost" a test finds. */
  const matches: TargetMatcher = async (_application, targets) =>
    targets.map(({ role, name, within }) => {
      const count = name === "Ghost" ? 0 : name === "Paid" ? 3 : name === "Active" && within === undefined ? 2 : 1;
      const scope = within === undefined ? "page" : `page.getByRole("${within.role}", { name: "${within.name}" })`;
      return { code: `${scope}.getByRole("${role}", { name: "${name}", exact: true })`, count, visible: count === 1 };
    });
  const tool = (action: string, result: unknown): ToolDefinition => ({
    name: `shop_${action}`,
    description: action,
    parameters: { type: "object" },
    execute: async () => result,
  });
  /** A proposal whose agent opened that page. */
  const opened = async () => {
    const actions = ["click", "fill", "select_option", "check"].map((action) => tool(action, {}));
    const screens = new ScreenWatch(
      ["shop"],
      [tool("goto", { url: "/orders", code: OPENED }), tool("snapshot", { page: PAGE, truncated: false }), ...actions],
      matches,
    );
    const made = await proposal({ screens }, false);
    await act(screens, "goto");
    return made;
  };
  const expecting = (id: string, shows: string[], absent: string[] = []) =>
    scenario(id, { steps: [{ action: "Open the orders", expects: [{ result: "The orders show", shows, absent }] }] });
  const ACTIVE = 'page.getByRole("cell", { name: "Active", exact: true })';
  const IN_ROW = 'page.getByRole("row", { name: "ORD-1 Active" }).getByRole("cell", { name: "Active", exact: true })';
  const PAID = 'page.getByRole("cell", { name: "Paid", exact: true })';
  const submitted = { scenarios: [expecting("a", ["Active", "Orders"]), expecting("b", ["Active"], ["Paid"]), expecting("c", ["Orders"])] };
  const ASKED = [
    "The plan is not accepted yet. The harness looked on the page for the element of each expected text, and asks you about 2 of them, once:",
    `Proposal 1: "Active" (scenario a, expect 1.1) is shown by 2 elements of shop. The harness proposes to assert it on one of them alone: ${IN_ROW}. Check that it is the element you mean: if it is, put 1 in accepts. Otherwise expect a more precise text, such as the text of the whole row.`,
    'Warning 2: "Paid" (scenario b, expect 1.1) is shown by 3 elements of shop, and the harness found no locator of one of them alone. If any of them will do, put 2 in accepts: the test will then assert that one of them at least shows it, or that none is left. Otherwise expect a more precise text, such as the text of the whole row.',
    "Next: call propose_plan again with the plan, what you correct in it, and accepts. What you leave unanswered is asserted on any of its elements, and is not asked again.",
  ].join("\n");
  const elementsOf = (made: PlanProposal) => made.accepted!.scenarios.map((kept) => kept.steps[0]!.expects[0]!.elements);
  const notes = (journal: Journal) => journal.entries().map((entry) => entry.message);

  it("refuses a text whose element designated nothing the page showed", async () => {
    const { proposal: made } = await opened();
    assert.deepEqual(await submit(made, { scenarios: [expecting("a", ["Ghost"]), expecting("b", ["Orders"]), expecting("c", ["Orders"])] }), {
      error:
        'Refused (PLAN-ELEMENT): scenario a, expect 1.1, names "Ghost", and its element, page.getByRole("cell", { name: "Ghost", exact: true }), designated nothing the page showed when the harness looked for it: a test would not find it. Take shop_snapshot of the screen that shows the text, then expect a text as a line of that snapshot gives it, such as the name of a heading or of a row, or the text of a message.\nNothing else was refused.',
    });
  });

  it("asks once about each element several share the locator of, proposes the locator of one alone when it found one, and writes what the agent accepts", async () => {
    const { proposal: made, journal } = await opened();
    assert.equal(await submit(made, submitted), ASKED);
    assert.equal(made.accepted, undefined);
    assert.deepEqual(notes(journal), [
      `The harness proposed to the agent (1) to assert "Active" on ${IN_ROW}: 2 elements share ${ACTIVE}.`,
      `The harness warned the agent (2) that 3 elements share ${PAID}, which shows "Paid".`,
    ]);
    assert.equal(await submit(made, { ...submitted, accepts: [1, 2] }), ACCEPTED);
    const heading = { text: "Orders", locator: 'page.getByRole("heading", { name: "Orders", exact: true })', field: false };
    assert.deepEqual(elementsOf(made), [
      [{ text: "Active", locator: IN_ROW, field: false }, heading],
      [
        { text: "Active", locator: IN_ROW, field: false },
        { text: "Paid", locator: PAID, field: false, count: 3 },
      ],
      [heading],
    ]);
    assert.deepEqual(notes(journal).slice(2, 4), [
      `The agent accepted proposal 1: "Active" is asserted on ${IN_ROW}.`,
      `The agent accepted warning 2: "Paid" is asserted on any of the 3 elements ${PAID}.`,
    ]);
  });

  it("asks nothing twice: what the agent leaves unanswered is asserted on any of the elements, by their number", async () => {
    const { proposal: made, journal } = await opened();
    assert.equal(await submit(made, submitted), ASKED);
    assert.equal(await submit(made, submitted), ACCEPTED);
    assert.deepEqual(elementsOf(made).slice(0, 2), [
      [
        { text: "Active", locator: ACTIVE, field: false, count: 2 },
        { text: "Orders", locator: 'page.getByRole("heading", { name: "Orders", exact: true })', field: false },
      ],
      [
        { text: "Active", locator: ACTIVE, field: false, count: 2 },
        { text: "Paid", locator: PAID, field: false, count: 3 },
      ],
    ]);
    assert.deepEqual(notes(journal).slice(2, 4), [
      `The agent left proposal 1 unanswered: "Active" is asserted on any of the 2 elements ${ACTIVE}.`,
      `The agent left warning 2 unanswered: "Paid" is asserted on any of the 3 elements ${PAID}.`,
    ]);
  });

  it("asks about an element the plan comes to name later, and only about it", async () => {
    const { proposal: made } = await opened();
    const first = { scenarios: [expecting("a", ["Active"]), expecting("b", ["Orders"]), expecting("c", ["Orders"])] };
    assert.match((await submit(made, first)) as string, /asks you about 1 of them, once:\nProposal 1: "Active"/);
    const later = (await submit(made, submitted)) as string;
    assert.match(later, /asks you about 1 of them, once:\nWarning 2: "Paid"/);
    assert.equal(await submit(made, { ...submitted, accepts: [2] }), ACCEPTED);
  });
});
