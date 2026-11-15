import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlanReview, TestPlan, ToolDefinition } from "@open-qa-stack/domain";
import { Journal } from "../src/common/journal.ts";
import type { DuplicateJudge, JudgedDuplicate } from "../src/designer/duplicate-judge.ts";
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
  level: "functional",
  effect: "read",
  case: "nominal",
  application: "shop",
  domain: "orders",
  sources: [{ source: "shop" }],
  data: [{ value: id, from: "made-up" }],
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
  levels: ["functional"],
  secrets: [],
  addresses: ["http://127.0.0.1:8090"],
  review: { review: async () => ({ accepted: true }) },
};

/** What the gates say of the scenarios of the shop when nothing was done on its screens. */
const UNEXPLORED = (scenarios: string) =>
  `you did nothing on the screens of shop in this session, and ${scenarios} about it: the harness writes the code of each step from the actions that did it. Open the first address of each scenario with shop_goto, do its steps with the browser tools, then give in actions of each step the numbers their results return in "action", such as "actions": [1, 2] for a step done by the actions 1 and 2.`;
/** What the agent is told of a plan accepted from which the harness took nothing out. */
/** How the result of a plan closed by the agent starts, by how many scenarios it holds. */
const accepted = (count: number) => `The plan was accepted with ${count} ${count === 1 ? "scenario" : "scenarios"}: the agent said the brief is covered.`;
const ACCEPTED = `${accepted(3)}\nNext: answer with one sentence. Call no more tools.`;
/** How the harness asks for more scenarios once it kept some. */
const ASKED = "The plan is not closed yet.";

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
  watched = screens;
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

/** The screens of the proposal made last, whose actions a plan cites. */
let watched: ScreenWatch | undefined;
/** The plan as the agent submits it: each step cites the first action, then every click done since, when the test names none. */
const cited = (submitted: Plan): SubmittedPlan => {
  const clicks = (watched?.actions("shop") ?? []).filter((action) => action.tool === "click").map((action) => action.number);
  return {
    ...submitted,
    scenarios: submitted.scenarios.map((planned) => ({ ...planned, steps: planned.steps.map((step) => ({ actions: [1, ...clicks], ...step })) })),
  };
};
/** Submits scenarios, and gives what the harness answers, such as its question about what is left to cover. */
const add = (proposal: PlanProposal, submitted: Plan) => proposal.tool().execute(cited(submitted)) as Promise<string | { error: string }>;
/** Submits a plan, then says the brief is covered once the harness asks what is left: the answer is that of the plan closed. */
const submit = async (proposal: PlanProposal, submitted: Plan) => {
  let answer = await add(proposal, submitted);
  // The harness asks what is left, then once whether a plan of what works alone is all the brief asks.
  for (let asks = 0; asks < 2 && typeof answer === "string" && answer.startsWith(ASKED); asks++) answer = await add(proposal, { scenarios: [] });
  return answer;
};
const act = (screens: ScreenWatch, action: string, args: object = {}) =>
  screens
    .tools()
    .find((tool) => tool.name === `shop_${action}`)!
    .execute(args);

describe("the scenarios of a plan, asked until the brief is covered", () => {
  /** What the harness asks once it kept scenarios. */
  const asked = (kept: string[], aside: string[] = []) =>
    [
      `The plan is not closed yet. It holds ${kept.length} ${kept.length === 1 ? "scenario" : "scenarios"}: ${kept.join(", ")}.`,
      ...aside,
      "Does the brief ask a business rule, an information or a behaviour none of these scenarios verifies?",
      'Next: if it does, call propose_plan with only the scenarios to add, each verifying what none above does; if the brief is covered, call propose_plan with "scenarios": []. A scenario that bears the id of one above replaces it.',
    ].join("\n");
  /** A scenario that does and expects what scenario a does, under other words. */
  const again = (id: string) => scenario(id, { data: scenario("a").data, title: "Another title", intent: "Another intent." });
  const identical = (id: string, of = "a") =>
    `Set aside (PLAN-DUPLICATE): scenario ${id} is a duplicate of ${of}. It does the same steps with the same values as ${of}, and expects nothing ${of} does not.`;
  const NOW = "2026-01-05T10:00:00.000Z";
  const now = () => new Date(NOW);
  const step = { action: "Open the orders", code: [OPENED], expects: [{ result: "The orders show", shows: ["Orders"], absent: [], elements: [HEADING] }] };

  it("keep the scenarios of each call, ask what is left, and close the plan once the agent adds nothing", async () => {
    const { proposal: made, journal } = await proposal({ review: slowReview(() => true) });
    // The calls of one turn are taken one at a time: the second adds to what the first kept.
    const [first, second] = await Promise.all([add(made, plan("a")), add(made, plan("b", "c"))]);
    assert.deepEqual([first, second], [asked(["a"]), asked(["a", "b", "c"])]);
    assert.deepEqual([made.accepted, made.drafted, made.reminder()], [undefined, true, undefined]);
    assert.equal(await add(made, { scenarios: [] }), ACCEPTED);
    // The plan kept holds what the harness wrote: the code of the action each step cites, and the element of each text a screen showed in one.
    assert.deepEqual(made.accepted, { scenarios: ["a", "b", "c"].map((id) => ({ ...scenario(id), steps: [step] })), ended: "covered" });
    assert.deepEqual(
      journal.entries().map((entry) => entry.message),
      ["The harness asked for no more scenarios: the agent said the brief is covered.", "The plan was accepted: a, b, c."],
    );
    // Once a plan is accepted, the session that plans is over: another is refused before it is read.
    assert.deepEqual(await submit(made, plan("x", "y", "z")), { error: made.closed() });
    assert.equal(made.drafted, false);
  });

  it("stop the design when the review refuses the plan closed, and keep nothing after", async () => {
    // A review that fails fails its call alone: the next one is taken.
    let failing = true;
    const review: PlanReview = {
      review: async (submitted) => {
        if (failing) throw new Error("The review failed.");
        return slowReview(() => false).review(submitted);
      },
    };
    const { proposal: made } = await proposal({ review });
    await add(made, plan("a", "b", "c"));
    await assert.rejects(add(made, { scenarios: [] }), /The review failed\./);
    failing = false;
    const refused = { error: "The plan was refused: Not this one. The design is stopped; call no more tools." };
    assert.deepEqual(await submit(made, plan("a", "b", "c")), refused);
    assert.deepEqual(await submit(made, plan("x")), refused);
    assert.deepEqual([made.accepted, made.refused, made.reminder(), made.drafted], [undefined, "Not this one.", undefined, false]);
  });

  it("refuse a plan without a scenario, keep as many as the brief takes, and replace a scenario by the one that bears its id", async () => {
    const { proposal: made } = await proposal();
    assert.deepEqual(await add(made, { scenarios: [] }), {
      error:
        "Refused (PLAN-COUNT): the plan holds no scenario. Give one scenario at least, for what the brief is about; or, when no test can do what the brief asks, say so: give in uncovered what it asks and why, with no scenario.\nNothing else was refused.",
    });
    assert.equal(await add(made, plan("a", "b")), asked(["a", "b"]));
    // The scenario b is submitted again, changed: it takes the place of the first.
    assert.equal(await add(made, { scenarios: [scenario("b", { title: "Changed" })] }), asked(["a", "b"]));
    assert.equal(await add(made, { scenarios: [] }), `${accepted(2)}\nNext: answer with one sentence. Call no more tools.`);
    assert.deepEqual(
      made.accepted!.scenarios.map((kept) => kept.title),
      ["The a scenario", "Changed"],
    );
  });

  it("accept a plan without a scenario that says why no test can do what the brief asks, and close it at once", async () => {
    const { proposal: made, journal } = await proposal();
    const uncovered = [{ asked: "Change the address of a customer.", reason: "No screen of shop offers to edit an address." }];
    assert.equal(
      await add(made, { scenarios: [], uncovered }),
      "The plan was accepted with 0 scenarios: the agent said no test can do what the brief asks.\nNext: answer with one sentence. Call no more tools.",
    );
    assert.deepEqual(made.accepted, { scenarios: [], uncovered, ended: "none" });
    assert.deepEqual(
      journal.entries().map((entry) => `${entry.level}: ${entry.message}`),
      [
        "error: The plan does not cover what the brief asks: Change the address of a customer. No screen of shop offers to edit an address.",
        "info: The harness asked for no more scenarios: the agent said no test can do what the brief asks.",
        "info: The plan was accepted: no scenario.",
      ],
    );
  });

  it("close a plan of one scenario with it, once the session of the agent ended without another", async () => {
    const { proposal: made, journal } = await proposal();
    await made.close();
    assert.equal(made.accepted, undefined);
    assert.equal(await add(made, plan("a")), asked(["a"]));
    await made.close();
    assert.deepEqual([made.accepted!.scenarios.length, made.accepted!.ended], [1, "session-end"]);
    assert.equal(journal.entries()[0]!.message, "The harness asked for no more scenarios: the agent ended its session without another scenario.");
  });

  it("set aside, by the code, a scenario that does what another does and expects no more, and tell the agent and the plan who decided and why", async () => {
    const { proposal: made, journal } = await proposal({ now });
    // Scenario b expects less than a at the same step, and c the same under other words: neither verifies anything a does not.
    const less = scenario("b", { data: scenario("a").data, steps: [{ action: "Open the orders", expects: [] }] });
    assert.equal(await add(made, { scenarios: [scenario("a"), less, scenario("d")] }), asked(["a", "d"], [identical("b")]));
    // A scenario that expects more than one kept, or enters another value, is another test.
    const more = scenario("e", {
      data: scenario("a").data,
      steps: [{ action: "Open the orders", expects: [{ result: "The orders show", shows: ["Orders", "ORD-1057 Lena Brook"], absent: [] }] }],
    });
    assert.equal(await add(made, { scenarios: [more, again("c")] }), asked(["a", "d", "e"], [identical("c")]));
    assert.equal(await add(made, { scenarios: [] }), ACCEPTED);
    const aside = (id: string, title: string, intent: string) => ({
      id,
      title,
      intent,
      duplicates: "a",
      origin: { by: "harness", check: "PLAN-DUPLICATE" },
      reason: "It does the same steps with the same values as a, and expects nothing a does not.",
      at: NOW,
    });
    assert.deepEqual(made.accepted!.setAside, [aside("b", "The b scenario", "Verifies b."), aside("c", "Another title", "Another intent.")]);
    assert.equal(
      journal.entries()[0]!.message,
      "The scenario b was set aside as a duplicate of a, by the harness (PLAN-DUPLICATE): It does the same steps with the same values as a, and expects nothing a does not.",
    );
  });

  it("answer duplicates in a row by degrees: tell the first, say at the second that the brief may be covered, and ask for no more at the third", async () => {
    const { proposal: made } = await proposal();
    const hint =
      'Reminder: the scenarios you last submitted were duplicates. Once every case of the brief has its scenario, say so: call propose_plan with "scenarios": [].';
    assert.equal(await add(made, { scenarios: [scenario("a"), again("b")] }), asked(["a"], [identical("b")]));
    assert.equal(await add(made, { scenarios: [again("c")] }), asked(["a"], [identical("c"), hint]));
    // A scenario kept in between starts the count again.
    assert.equal(await add(made, plan("d")), asked(["a", "d"]));
    assert.equal(await add(made, { scenarios: [again("e"), again("f")] }), asked(["a", "d"], [identical("e"), identical("f"), hint]));
    assert.equal(
      await add(made, { scenarios: [again("g")] }),
      [
        "The plan was accepted with 2 scenarios: the scenarios last submitted were duplicates, and the agent has nothing new to verify.",
        identical("g"),
        "Next: answer with one sentence. Call no more tools.",
      ].join("\n"),
    );
    assert.deepEqual([made.accepted!.ended, made.accepted!.setAside!.length], ["exhausted", 5]);
  });

  it("ask the judge about the scenarios the code let through, keep of its answer what names one of them and a scenario before it, and go on without it when it fails", async () => {
    const calls: unknown[] = [];
    const answers: (JudgedDuplicate[] | Error | string)[] = [
      [
        { id: "c", of: "a", reason: "Both open the orders and read their heading." },
        { id: "c", of: "b", reason: "Said twice." },
        { id: "a", of: "c", reason: "Names a scenario after it." },
        { id: "zz", of: "a", reason: "Names no scenario." },
      ],
      new Error("no answer"),
      [
        { id: "e", of: "b", reason: "Same as b." },
        { id: "f", of: "e", reason: "Same as e." },
      ],
      "down",
    ];
    const judge: DuplicateJudge = {
      judge: async (kept, candidates) => {
        calls.push([kept.map((item) => item.id), candidates.map((item) => item.id)]);
        const answer = answers.shift()!;
        if (!Array.isArray(answer)) throw answer;
        return answer;
      },
    };
    const { proposal: made, journal } = await proposal({ judge, now });
    // One scenario alone has nothing to be compared with, and one the code set aside is not asked about.
    assert.equal(await add(made, { scenarios: [scenario("a"), again("x")] }), asked(["a"], [identical("x")]));
    const byJudge = "Set aside (plan reviewer): scenario c is a duplicate of a. Both open the orders and read their heading.";
    assert.equal(await add(made, plan("b", "c")), asked(["a", "b"], [byJudge]));
    assert.equal(await add(made, plan("d")), asked(["a", "b", "d"]));
    // A scenario the judge finds the duplicate of one it sets aside is the duplicate of the one kept.
    const chained = [
      "Set aside (plan reviewer): scenario e is a duplicate of b. Same as b.",
      "Set aside (plan reviewer): scenario f is a duplicate of b. Same as e.",
    ];
    assert.equal(await add(made, plan("e", "f", "g")), asked(["a", "b", "d", "g"], chained));
    assert.equal(await add(made, plan("h")), asked(["a", "b", "d", "g", "h"]));
    assert.deepEqual(calls, [
      [["a"], ["b", "c"]],
      [["a", "b"], ["d"]],
      [
        ["a", "b", "d"],
        ["e", "f", "g"],
      ],
      [["a", "b", "d", "g"], ["h"]],
    ]);
    assert.equal(journal.entries().at(-1)!.message, "The review of the plan for duplicates failed, and the plan goes on without it: down");
    await made.close();
    assert.deepEqual(made.accepted!.setAside![1], {
      id: "c",
      title: "The c scenario",
      intent: "Verifies c.",
      duplicates: "a",
      origin: { by: "agent", role: "plan-reviewer" },
      reason: "Both open the orders and read their heading.",
      at: NOW,
    });
    assert.deepEqual(
      journal
        .entries()
        .map((entry) => `${entry.level}: ${entry.message}`)
        .slice(1, 6),
      [
        "info: The harness left out an answer of the plan reviewer: c as a duplicate of b.",
        "info: The harness left out an answer of the plan reviewer: a as a duplicate of c.",
        "info: The harness left out an answer of the plan reviewer: zz as a duplicate of a.",
        "info: The scenario c was set aside as a duplicate of a, by the plan reviewer: Both open the orders and read their heading.",
        "error: The review of the plan for duplicates failed, and the plan goes on without it: no answer",
      ],
    );
    // What the judge reads of a scenario: what it is, what it enters, and each step with what it expects.
    const read: string[] = [];
    const reader: DuplicateJudge = { judge: async (kept) => (read.push(...kept.map((item) => item.text)), []) };
    const { proposal: other } = await proposal({ judge: reader });
    const gone = scenario("a", {
      steps: [
        { action: "Open the orders", expects: [{ result: "The orders show", shows: ["Orders"], absent: ["ORD-1057 Lena Brook"] }] },
        { action: "Wait", expects: [] },
      ],
    });
    await add(other, { scenarios: [gone, scenario("b", { data: [] })] });
    await add(other, plan("c"));
    assert.deepEqual(read, [
      'The a scenario (nominal, shop). Verifies a.\nEnters: "a"\n1. Open the orders -> The orders show; shows "Orders"; no longer shows "ORD-1057 Lena Brook"\n2. Wait',
      'The b scenario (nominal, shop). Verifies b.\n1. Open the orders -> The orders show; shows "Orders"',
    ]);
  });
});

describe("the gates of a plan", () => {
  const found = { result: "The order of Mira Veldane shows", shows: ["ORD-1042"], absent: [] };
  const functional = (id: string, changes: Partial<Scenario> = {}) =>
    scenario(id, {
      kind: "functional",
      level: "functional",
      effect: "read",
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

  it("take as a value the application gave one the address a click led to holds, and not one of an address the agent opened itself", async () => {
    const tool = (action: string): ToolDefinition => ({
      name: `shop_${action}`,
      description: action,
      parameters: { type: "object" },
      execute: async () => {
        if (action === "snapshot") return { page: '- heading "Orders"', truncated: false };
        return action === "goto" ? { url: "http://shop.test/orders/typed-41", code: OPENED } : { url: "http://shop.test/orders/k9z7q", code: CLICKED };
      },
    });
    const screens = new ScreenWatch(["shop"], ["goto", "snapshot", "fill", "click", "select_option", "check"].map(tool));
    const { proposal: made } = await proposal({ screens }, false);
    await act(screens, "goto");
    const opening = (value: string) => plan("a").scenarios.map((planned) => ({ ...planned, data: [{ value, from: "shop" }] }));
    // The identifier of the order is in no line of a screen: before the click, nothing gave it.
    assert.match(
      ((await submit(made, { scenarios: opening("k9z7q") })) as { error: string }).error,
      /^Refused \(PLAN-DATA\): no result of shop showed "k9z7q" in this session\./,
    );
    await act(screens, "click");
    assert.match(
      ((await submit(made, { scenarios: opening("typed-41") })) as { error: string }).error,
      /^Refused \(PLAN-DATA\): no result of shop showed "typed-41" in this session\./,
    );
    assert.match((await submit(made, { scenarios: opening("k9z7q") })) as string, /^The plan was accepted with 1 scenario/);
    assert.equal(new ScreenWatch([], []).reached("shop", "k9z7q"), false);
  });

  it("refuse a step whose action left the screens of its application for an address of the configuration, once for the action", async () => {
    const elsewhere = 'await page.goto("http://127.0.0.1:8090/swagger-ui/index.html");';
    const tool = (action: string): ToolDefinition => ({
      name: `shop_${action}`,
      description: action,
      parameters: { type: "object" },
      execute: async () => (action === "snapshot" ? { page: '- heading "Orders"', truncated: false } : action === "goto" ? { code: elsewhere } : {}),
    });
    const screens = new ScreenWatch(["shop"], ["goto", "snapshot", "fill", "click", "select_option", "check"].map(tool));
    const { proposal: made } = await proposal({ screens }, false);
    await act(screens, "goto");
    const refused = (await submit(made, plan("a"))) as { error: string };
    assert.equal(
      refused.error,
      `Refused (PLAN-ADDRESS): scenario a, step 1, cites the action 1 (${elsewhere}), which holds http://127.0.0.1:8090, an address of the configuration: a test of shop acts on the screens of shop alone, reached by a path relative to its base URL. Do the step on those screens, opened with shop_goto and a path such as "/orders", and cite those actions; say in uncovered what only another address offers.\nNothing else was refused.`,
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

  it("close the plan with the scenarios it holds when six calls in a row are refused, and count the refusals again from each call kept", async () => {
    const { proposal: made, journal } = await proposal();
    const twice = { scenarios: [scenario("c"), scenario("c")] };
    // Five refusals, a call kept, then five more: none of the two runs of refusals reaches six.
    for (let at = 0; at < 5; at += 1) await add(made, twice);
    assert.equal(typeof (await add(made, plan("a"))), "string");
    for (let at = 0; at < 5; at += 1) assert.ok("error" in ((await add(made, twice)) as object));
    assert.equal(made.accepted, undefined);
    // The sixth in a row closes the plan with what it holds: the scenario kept is not lost.
    const closed = await add(made, twice);
    assert.match(
      closed as string,
      /^The plan was accepted with 1 scenario: the harness refused the scenarios last submitted, time after time, and kept those the plan held\./,
    );
    assert.deepEqual([made.accepted!.scenarios.map((kept) => kept.id), made.accepted!.ended, made.refused], [["a"], "refused", undefined]);
    assert.ok(
      journal
        .entries()
        .some((entry) => entry.message === "The harness refused 6 calls in a row, the last one for PLAN-ID: the plan is closed with the scenarios it holds."),
    );
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
        level: "functional",
        effect: "read",
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
      level: "functional",
      effect: "read",
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
    const found = { action: "Find the order of Lena Brook", actions: [1], expects: [{ result: "Its order shows", shows: ["Lena Brook"], absent: [] }] };
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
      steps: [
        { action: "Type Lena Brook in the search field", actions: [1], expects: [{ ...typed("Lena Brook"), shows: ["Lena Brook", "Orders"] }] },
        answered,
      ],
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
    assert.deepEqual(await submit(made, { scenarios: [unseen, sent, scenario("z")] }), {
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
      await submit(made, { scenarios: [negative, nominal, scenario("z")] }),
      [
        accepted(3),
        'The harness took "Quill Zed" out of expect 1.1 of scenario a: the field echoes what the step types.',
        'The harness took "quill  zed" out of expect 1.2 of scenario a: the field echoes what the step types.',
        "Next: answer with one sentence. Call no more tools.",
      ].join("\n"),
    );
    assert.deepEqual(
      made.accepted!.scenarios.slice(0, 2).map((kept) => kept.steps.map((step) => step.expects.map((expect) => [expect.shows, expect.absent]))),
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
        "The harness asked for no more scenarios: the agent said the brief is covered.",
        "The plan was accepted: a, b, z.",
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
    assert.equal(await submit(made, { scenarios: [searched("a", "negative"), opened] }), `${accepted(2)}\nNext: answer with one sentence. Call no more tools.`);
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
      'Refused (PLAN-LOCATOR): scenario b, step 1, "Open the orders", cites the action 1, done on desk: a test of the level functional acts on shop alone. If the scenario verifies in one application what it did in the other, give it the level cross-application, which a test of two applications has; otherwise do the step with the browser tools of shop, such as shop_click, and cite the numbers their results return in "action".',
      'Refused (PLAN-LOCATOR): scenario b, step 1, "Open the orders", cites the action 7, which no browser tool returned in this session. Give in actions the numbers the results of the browser tools of shop return in "action"; do the step again if you no longer have them.',
      'Refused (PLAN-LOCATOR): scenario c, step 1, "Open the orders", cites the action 1, done on desk: a test of the level functional acts on shop alone. If the scenario verifies in one application what it did in the other, give it the level cross-application, which a test of two applications has; otherwise do the step with the browser tools of shop, such as shop_click, and cite the numbers their results return in "action".',
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
      level: "functional",
      effect: "read",
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

describe("a step and what it expects, held to one screen", () => {
  const search = (actions: number[]) =>
    scenario("a", {
      kind: "functional",
      level: "functional",
      effect: "read",
      data: [{ value: "zzqx", from: "made-up" }],
      steps: [
        { action: "Open the orders", actions: [1], expects: [{ result: "The orders show", shows: ["Orders"], absent: [] }] },
        { action: "Search the orders of Veldane", actions, expects: [{ result: "Her order shows", shows: ["ORD-1042"], absent: [] }] },
      ],
    });

  it("refuses a text the screen showed after another action than those its step cites, and names that action", async () => {
    const { proposal: made, screens } = await proposal();
    await act(screens, "fill", { value: "zzqx" });
    await act(screens, "click");
    const refused = (await add(made, { scenarios: [search([2])] })) as { error: string };
    assert.equal(
      refused.error.split("\n")[0],
      'Refused (PLAN-SHOWN): scenario a, expect 2.1, names "ORD-1042", which the screen did not show after the last action step 2 cites (2): it showed it after the action 3. A test asserts what a step expects once its last action is done, and would not find it. End the step on the action that leads to the screen that shows "ORD-1042" — make another step of what comes after —, or expect what the screen showed after the action 2.',
    );
    assert.match((await submit(made, { scenarios: [search([2, 3])] })) as string, /^The plan was accepted with 1 scenario/);
  });
});

describe("a plan that verifies only what works", () => {
  const nominal = () => scenario("a", { kind: "functional" });

  it("is asked once what the application answers otherwise, and closed when the agent says again that the brief is covered", async () => {
    const { proposal: made, journal } = await proposal();
    await add(made, { scenarios: [nominal()] });
    const warned = await add(made, { scenarios: [] });
    assert.match(
      warned as string,
      /^The plan is not closed yet\. It holds a \(functional\)\.\nIt verifies only what works\. [^]*call propose_plan with "scenarios": \[\] again: that confirms it, and closes the plan\.$/,
    );
    assert.equal(await add(made, { scenarios: [] }), `${accepted(1)}\nNext: answer with one sentence. Call no more tools.`);
    assert.equal(
      journal
        .entries()
        .filter((entry) => entry.message === "The agent closed a plan that verifies only what works; it was asked once whether the brief calls for more.")
        .length,
      1,
    );
  });

  it("is closed at once when a scenario is negative, or none is functional", async () => {
    const { proposal: made } = await proposal();
    await add(made, { scenarios: [scenario("a")] });
    assert.match((await add(made, { scenarios: [] })) as string, /^The plan was accepted/);
  });
});

describe("the level of a scenario, held to what its actions went through", () => {
  /** Browser tools of three applications: one opens the address asked, and a click opens the order. */
  const tools = (): ToolDefinition[] =>
    ["shop", "desk", "ledger"].flatMap((application) => {
      let count = 0;
      const tool = (action: string, execute: (args: { url?: string }) => unknown): ToolDefinition => ({
        name: `${application}_${action}`,
        description: action,
        parameters: { type: "object" },
        execute: async (args) => execute(args as { url?: string }),
      });
      const done = (url: string | undefined) => ({
        ...(url === undefined ? {} : { url }),
        code: url === undefined || url.startsWith("http") ? `await ${application}.act(${(count += 1)});` : `await page.goto(${JSON.stringify(url)});`,
      });
      return [
        tool("goto", ({ url = "/orders" }) => done(url)),
        tool("snapshot", () => ({ page: '- heading "Orders"', truncated: false })),
        tool("click", () => done("http://127.0.0.1:3000/orders/1042")),
        tool("fill", () => done(undefined)),
        tool("select_option", () => done(undefined)),
        tool("check", () => done(undefined)),
      ];
    });
  const levels = ["smoke", "functional", "business", "cross-application", "end-to-end"] as const;
  /** A proposal whose agent opened the orders (1), searched (2), opened an order (3), opened the desk (4), clicked there (5), then opened the ledger (6). */
  const explored = async (asked: readonly (typeof levels)[number][] = levels) => {
    const screens = new ScreenWatch(["shop", "desk", "ledger"], tools());
    const call = (name: string, args: object = {}) =>
      screens
        .tools()
        .find((tool) => tool.name === name)!
        .execute(args);
    await call("shop_goto");
    await call("shop_fill");
    await call("shop_click");
    await call("desk_goto", { url: "/tickets" });
    await call("desk_click");
    await call("ledger_goto");
    const { reads } = await proposal();
    return new PlanProposal({ ...RULES, applications: ["shop", "desk", "ledger"], levels: asked, screens, reads }, new Journal());
  };
  const at = (level: (typeof levels)[number], actions: number[]) =>
    scenario("a", {
      level,
      data: [],
      steps: [{ action: "Open the orders", actions, expects: [{ result: "The orders show", shows: ["Orders"], absent: [] }] }],
    });
  const answered = async (made: PlanProposal, planned: Scenario) => {
    const answer = await made.tool().execute({ scenarios: [planned] });
    return typeof answer === "string"
      ? "kept"
      : (answer as { error: string }).error.split("\n")[0]!.replace(/^Refused \(PLAN-LEVEL\): scenario a is of the level /, "");
  };

  it("keeps a scenario whose actions are those of its level", async () => {
    const kept = [at("smoke", [1]), at("functional", [1, 2]), at("business", [1, 2, 3])];
    for (const planned of kept) assert.equal(await answered(await explored(), planned), "kept", planned.level);
  });

  it("refuses a level the plan is not asked for, and names those asked", async () => {
    assert.equal(
      await answered(await explored(["smoke", "functional"]), at("business", [1, 2, 3])),
      "business, which this plan is not asked for. The levels asked: smoke, functional. Give it one of them, or leave the scenario out and say so in uncovered.",
    );
  });

  it("refuses a smoke test that does more than open an address, and a test of one application whose screens are not those of its level", async () => {
    assert.match(
      await answered(await explored(), at("smoke", [1, 2])),
      /^smoke, and one of its actions does more than open an address: .* or give it the level functional\.$/,
    );
    assert.match(
      await answered(await explored(), at("functional", [1, 3])),
      /^functional, and its actions went through 2 screens \(\/orders, \/orders\/:id\): a functional test verifies one behaviour of one screen\. Give it the level business /,
    );
    assert.match(
      await answered(await explored(), at("business", [1, 2])),
      /^business, and its actions went through 1 screen \(\/orders\): a business test follows a journey through several screens to its result\. Give it the level functional, /,
    );
  });

  it("holds a test of several applications to how many it acts on, and a test of one application to that one", async () => {
    assert.match(
      await answered(await explored(), at("cross-application", [1, 3])),
      /^cross-application, and its actions were done on one application \(shop\): .* or give it the level business\.$/,
    );
    assert.match(
      await answered(await explored(), at("cross-application", [1, 4, 6])),
      /^cross-application, and its actions were done on 3 applications \(shop, desk, ledger\): .* or give it the level end-to-end\.$/,
    );
    assert.match(
      await answered(await explored(), at("end-to-end", [1, 4])),
      /^end-to-end, and its actions were done on 2 applications \(shop, desk\): .* or give it the level cross-application\.$/,
    );
    assert.match(
      await answered(await explored(), at("end-to-end", [1])),
      /^end-to-end, and its actions were done on one application \(shop\): .* or give it the level business\.$/,
    );
    const alone = (await (await explored()).tool().execute({ scenarios: [at("business", [1, 4])] })) as { error: string };
    assert.match(
      alone.error,
      /^Refused \(PLAN-LOCATOR\): scenario a, step 1, "Open the orders", cites the action 4, done on desk: a test of the level business acts on shop alone\. If the scenario verifies in one application what it did in the other, give it the level cross-application, /,
    );
  });

  it("keeps a test of several applications, does on the tab of each other one what was done on it, and names them in the plan", async () => {
    const made = await explored();
    assert.equal(await answered(made, at("cross-application", [1, 2, 4, 5])), "kept");
    // The plan is closed once the agent confirms it holds no scenario of the other levels asked.
    const doubted = (await made.tool().execute({ scenarios: [] })) as string;
    assert.match(
      doubted,
      /^The plan is not closed yet\. It holds a \(cross-application\)\.\nNo scenario is of the level smoke, which is asked: one scenario of one step that opens the first address/,
    );
    await made.tool().execute({ scenarios: [] });
    const [kept] = made.accepted!.scenarios;
    assert.deepEqual(
      [kept!.application, kept!.applications, kept!.steps[0]!.application, kept!.steps[0]!.code],
      [
        "shop",
        ["desk"],
        "desk",
        [
          'await page.goto("/orders");',
          "await shop.act(1);",
          'await deskPage.goto(new URL("/tickets", process.env.OQAS_BASE_URL_DESK).href);',
          "await desk.act(1);",
        ],
      ],
    );
    assert.equal(await answered(await explored(), at("end-to-end", [1, 4, 6])), "kept");
  });

  it("refuses a first action on another application that opens no address: its tab is empty", async () => {
    const refused = (await (await explored()).tool().execute({ scenarios: [at("cross-application", [1, 5])] })) as { error: string };
    assert.match(
      refused.error,
      /^Refused \(PLAN-START\): scenario a cites the action 5 \(await desk\.act\(1\);\) as the first it does on desk, and it opens no address: its test opens a tab for desk, empty until an address is opened on it\. Open the address with desk_goto, do the step from there, and cite that action before the action 5\./,
    );
    // Once its address was opened, the test comes back to the tab of an application without opening it again.
    assert.equal(await answered(await explored(), at("cross-application", [1, 4, 2, 5])), "kept");
  });

  it("names, when it asks for more, the levels asked that no scenario is of yet", async () => {
    const made = await explored(["smoke", "functional", "business"]);
    const asked = (await made.tool().execute({ scenarios: [at("functional", [1, 2])] })) as string;
    assert.ok(
      asked.includes("\nNo scenario is of the levels smoke, business yet, among those asked (smoke, functional, business): add those the brief calls for.\n"),
      asked,
    );
    const one = await explored(["smoke", "functional"]);
    const again = (await one.tool().execute({ scenarios: [at("functional", [1, 2])] })) as string;
    assert.ok(again.includes("\nNo scenario is of the level smoke yet, among those asked (smoke, functional): add those the brief calls for.\n"), again);
  });
});

describe("the effect of a scenario on the data of the environment", () => {
  /** Browser tools of the shop whose click saves an order. */
  const tools = (): ToolDefinition[] =>
    ["goto", "snapshot", "click", "fill", "select_option", "check"].map((action) => ({
      name: `shop_${action}`,
      description: action,
      parameters: { type: "object" },
      execute: async () => (action === "snapshot" ? { page: '- heading "Orders"', truncated: false } : { url: "/orders", code: `await page.${action}();` }),
    }));
  const saved = async () => {
    const screens = new ScreenWatch(["shop"], tools());
    const call = (name: string, args: object = {}) =>
      screens
        .tools()
        .find((tool) => tool.name === name)!
        .execute(args);
    await call("shop_goto");
    await call("shop_click", { target: { role: "button", name: "Save the order" } });
    await call("shop_click", { target: { role: "link", name: "Orders" } });
    const { reads } = await proposal();
    return new PlanProposal({ ...RULES, screens, reads }, new Journal());
  };
  const told = (effect: "read" | "write", actions: number[]) =>
    scenario("a", {
      effect,
      data: [],
      steps: [{ action: "Open the orders", actions, expects: [{ result: "The orders show", shows: ["Orders"], absent: [] }] }],
    });

  it("refuses a scenario said to only read that cites a click whose name says it writes, and keeps it once it says it writes", async () => {
    const refused = (await (await saved()).tool().execute({ scenarios: [told("read", [1, 2])] })) as { error: string };
    assert.match(
      refused.error,
      /^Refused \(PLAN-EFFECT\): scenario a is said to only read the data of the environment, and it cites the action 2 \(await page\.click\(\);\), a click on "Save the order", which may create, change or remove some\. Give it the effect write, /,
    );
    assert.equal(typeof (await (await saved()).tool().execute({ scenarios: [told("write", [1, 2])] })), "string");
    // A click whose name says nothing of the kind is one of a scenario that reads.
    assert.equal(typeof (await (await saved()).tool().execute({ scenarios: [told("read", [1, 3])] })), "string");
  });

  it("refuses a scenario that writes, makes go a text it starts from and never brings it back, and keeps one that puts it back", async () => {
    const step = (action: string, actions: number[], shows: string[], absent: string[] = []) => ({
      action,
      actions,
      expects: [{ result: action, shows, absent }],
    });
    const changing = (...last: ReturnType<typeof step>[]) =>
      scenario("a", { effect: "write", data: [], steps: [step("Open the orders", [1], ["Orders"]), step("Rename the list", [2], [], ["Orders"]), ...last] });
    const refused = (await (await saved()).tool().execute({ scenarios: [changing()] })) as { error: string };
    assert.match(
      refused.error,
      /^Refused \(PLAN-EFFECT\): scenario a finds "Orders" at step 1, makes it go at step 2, and no step after brings it back: its test would pass once, then fail when run again, since what it starts from is gone\. Add a last step that puts it back /,
    );
    assert.equal(typeof (await (await saved()).tool().execute({ scenarios: [changing(step("Give the list its name back", [3], ["Orders"]))] })), "string");
    // What a step shows once the scenario wrote is its own: taking it away again is none of what it starts from.
    const own = scenario("a", {
      effect: "write",
      data: [],
      steps: [step("Save an order", [1, 2], []), step("See it", [3], ["Orders"]), step("Remove it", [3], [], ["Orders"])],
    });
    assert.equal(typeof (await (await saved()).tool().execute({ scenarios: [own] })), "string");
    // Without a click whose name says it writes, what the scenario starts from is what its first step finds.
    const quiet = scenario("a", { effect: "write", data: [], steps: [step("Open the orders", [1], ["Orders"]), step("Leave", [3], [], ["Orders"])] });
    assert.match(
      ((await (await saved()).tool().execute({ scenarios: [quiet] })) as { error: string }).error,
      /^Refused \(PLAN-EFFECT\): scenario a finds "Orders" at step 1, makes it go at step 2/,
    );
  });
});

describe("the start of a scenario that writes, looked at again by the harness", () => {
  /** Browser tools of a shop whose list shows an order until a click on Save renames it. */
  const shop = () => {
    const state = { renamed: false, down: false };
    const tool = (action: string, execute: (args: { url?: string; target?: { name?: string } }) => unknown): ToolDefinition => ({
      name: `shop_${action}`,
      description: action,
      parameters: { type: "object" },
      execute: async (args) => execute(args as { url?: string }),
    });
    return {
      state,
      tools: [
        tool("goto", ({ url = "/orders" }) => {
          if (state.down) throw new Error("The page did not answer.");
          return { url, code: `await page.goto(${JSON.stringify(url)});` };
        }),
        tool("snapshot", () => ({ page: `- heading "Orders"\n- row "${state.renamed ? "ORD-2000" : "ORD-1042"} Mira Veldane"`, truncated: false })),
        tool("click", ({ target }) => {
          state.renamed = target?.name === "Save";
          return { code: `await page.getByRole("button", { name: "${target?.name}" }).click();` };
        }),
        ...["fill", "select_option", "check"].map((action) => tool(action, () => ({ code: `await page.${action}();` }))),
      ],
    };
  };
  const explored = async () => {
    const { state, tools } = shop();
    const screens = new ScreenWatch(["shop"], tools);
    const call = (name: string, args: object = {}) =>
      screens
        .tools()
        .find((tool) => tool.name === name)!
        .execute(args);
    const journal = new Journal();
    const { reads } = await proposal();
    const made = new PlanProposal({ ...RULES, screens, reads }, journal);
    return { state, call, journal, made };
  };
  const step = (action: string, actions: number[], shows: string[], absent: string[] = []) => ({
    action,
    actions,
    expects: [{ result: action, shows, absent }],
  });
  /** Opens the orders (1), renames the order with Save (2), then puts its name back with Undo (3). */
  const renaming = scenario("a", {
    effect: "write",
    data: [],
    steps: [
      step("Open the orders", [1], ["ORD-1042"]),
      step("Rename the order", [2], ["ORD-2000"], ["ORD-1042"]),
      step("Give it its name back", [3], ["ORD-1042"], ["ORD-2000"]),
    ],
  });

  /** The agent opens the orders (1), renames the order (2), puts its name back (3), then renames it again (4), which no step cites. */
  const changedAgain = async () => {
    const given = await explored();
    await given.call("shop_goto", { url: "/orders" });
    await given.call("shop_click", { target: { role: "button", name: "Save" } });
    await given.call("shop_click", { target: { role: "button", name: "Undo" } });
    await given.call("shop_click", { target: { role: "button", name: "Save" } });
    return given;
  };

  it("refuses the plan when the page the scenario starts on no longer shows what its first step finds, and says what the harness saw", async () => {
    const { journal, made } = await changedAgain();
    const refused = (await made.tool().execute({ scenarios: [renaming] })) as { error: string };
    assert.match(
      refused.error,
      /^Refused \(PLAN-EFFECT\): scenario a starts from "ORD-1042" at step 1, and the harness, which opened \/orders again, no longer finds it there: what you changed while you explored is still changed, and the test would fail at its first step\. Put it back on the screens, [^]* If it cannot be put back, start the scenario from what the page shows now\./,
    );
    assert.ok(journal.entries().some((entry) => entry.message === 'The harness opened /orders of shop again: it no longer shows "ORD-1042".'));
  });

  it("keeps the plan once what was changed is put back, and holds it to nothing when the page cannot be read or its first step does more than open it", async () => {
    const back = await explored();
    await back.call("shop_goto", { url: "/orders" });
    await back.call("shop_click", { target: { role: "button", name: "Save" } });
    await back.call("shop_click", { target: { role: "button", name: "Undo" } });
    assert.equal(typeof (await back.made.tool().execute({ scenarios: [renaming] })), "string");
    const down = await changedAgain();
    down.state.down = true;
    assert.equal(typeof (await down.made.tool().execute({ scenarios: [renaming] })), "string");
    const acting = await changedAgain();
    const first = { ...renaming, steps: [{ ...renaming.steps[0]!, actions: [1, 3] }, renaming.steps[1]!, renaming.steps[2]!] };
    assert.equal(typeof (await acting.made.tool().execute({ scenarios: [first] })), "string");
  });
});
