import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { answer, toolCalls } from "@open-qa-stack/testing";
import type { PlanReview } from "@open-qa-stack/domain";
import {
  MODEL,
  BRANCH,
  DB_URL,
  git,
  snapshot,
  spec,
  scenario,
  IDS,
  OPEN,
  SEARCH,
  PLAN,
  COVERED,
  KEPT,
  run,
  close,
  DONE,
  write,
  valid,
  replies,
  FakeTestRunner,
  design,
  messages,
  toolsOffered,
  requestText,
  sessions,
  asked,
  toolResult,
  told,
  stateOf,
  planOf,
  customersRepository,
} from "./designer-support.ts";

describe("brief, criterion 1 — from the brief, the knowledge tools lead to the customers and the section of the guide, which is read", () => {
  it("finds the domain and the section, names the tool of the guide, and reads it", async () => {
    const find = { id: "f1", name: "knowledge_list", arguments: { words: "customer search" } };
    const entry = { id: "e1", name: "knowledge_read", arguments: { source: "shop-guide", item: "Customer search" } };
    const read = { id: "s1", name: "shop_guide_read_section", arguments: { number: 2 } };
    const { outcome, server } = await design(replies([[OPEN, find], [entry], [read], [PLAN], DONE, ...valid(3)]), {
      root: customersRepository(),
      plan: false,
      brief: "tester la recherche d'un client",
    });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.ok(requestText(server).includes("<brief>\\ntester la recherche d'un client\\n</brief>"));
    assert.match(toolResult(server, "f1"), /shop-guide: Customer search/);
    assert.match(
      toolResult(server, "e1"),
      /Source shop-guide \(document\): read it with shop_guide_list_files, shop_guide_list_sections, shop_guide_read_section, shop_guide_read_file, shop_guide_search\./,
    );
    assert.match(toolResult(server, "e1"), /Domains: customers\./);
    assert.match(toolResult(server, "s1"), /finds a customer by the start of their last name/);
    assert.equal(stateOf(outcome).brief, "tester la recherche d'un client");
  });
});

describe("what the workflow of a source wrote of it", () => {
  it("is given by the knowledge tools: the file of its domain, and the definition of an element from its export", async () => {
    const root = customersRepository();
    const folder = join(root, ".oqas", "index", "sources", "shop-guide");
    mkdirSync(join(folder, "domains"), { recursive: true });
    mkdirSync(join(folder, "export", "sections"), { recursive: true });
    writeFileSync(join(folder, "domains", "search.md"), "# Search (`search`)\n\n`Customer search` tells how a clerk finds a customer.");
    writeFileSync(join(folder, "export", "sections", "customer-search.md"), "## Customer search\n\nBy the start of the last name.");
    const described = { label: "Search", description: "Finding a customer." };
    writeFileSync(
      join(folder, "manifest.json"),
      JSON.stringify({
        formatVersion: 1,
        source: { id: "shop-guide", type: "document" },
        fingerprint: "sha256:0",
        producedAt: "2026-11-13T09:00:00.000Z",
        status: "complete",
        // A domain may have no file yet, or one that was lost: neither is given.
        domains: [
          { id: "search", ...described, file: "domains/search.md", writtenBy: "model" },
          { id: "pending", ...described },
          { id: "lost", ...described, file: "domains/lost.md", writtenBy: "model" },
        ],
        elements: [
          {
            name: "Customer search",
            kind: "section",
            fingerprint: "sha256:1",
            file: "export/sections/customer-search.md",
            domain: "search",
            role: "How to find a customer.",
          },
        ],
      }),
    );
    const inDomain = { id: "d1", name: "knowledge_domain", arguments: { domain: "customers", source: "shop-guide" } };
    const one = { id: "r1", name: "knowledge_read", arguments: { source: "shop-guide", item: "Customer search" } };
    const { outcome, server } = await design(replies([[OPEN, inDomain], [one], [PLAN], DONE, ...valid(3)]), { root, plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.match(toolResult(server, "d1"), /`Customer search` tells how a clerk finds a customer\./);
    assert.match(toolResult(server, "r1"), /Definition, from export\/sections\/customer-search\.md:.*## Customer search/);
  });
});

describe("a plan of as many scenarios as its brief needs", () => {
  const planOf = (...ids: string[]) => ({ ...PLAN, arguments: { scenarios: ids.map((id) => scenario(id)) } });

  it("succeeds once each of its scenarios has its test: two, or one alone", async () => {
    for (const ids of [["list-orders", "place-order"], ["list-orders"]]) {
      const { outcome } = await design(replies([[OPEN], [planOf(...ids)], DONE, ...valid(ids.length)]), { plan: false });
      assert.equal(outcome.ok, true, messages(outcome));
      assert.equal(outcome.tests.length, ids.length);
    }
  });

  it("fails, saying how many are expected, when one of them has none that counts", async () => {
    // The agent that writes the only scenario gives up: its test is kept unfinished, and counts for none.
    const { outcome } = await design(replies([[OPEN], [planOf("list-orders")], DONE, DONE, DONE, DONE, DONE]), { plan: false });
    assert.equal(outcome.ok, false);
    assert.match(messages(outcome), /The design failed: 0 tests were obtained, 1 is expected, one per scenario of the plan\./);
  });
});

describe("what the brief asks and the application does not allow", () => {
  it("goes from the plan to its file and to the outcome of the design, and is none for a plan that covers the brief", async () => {
    const uncovered = [{ asked: "Cancel an order.", reason: "No screen of shop offers to cancel one." }];
    const partial = { ...PLAN, arguments: { ...PLAN.arguments, uncovered } };
    const { outcome } = await design(replies([[OPEN], [partial], DONE, ...valid(3)]), { plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.deepEqual(outcome.uncovered, uncovered);
    assert.match(
      readFileSync(outcome.planPath!, "utf8"),
      /\n## Not covered\n\nThe brief asks what follows, and no scenario does it:\n\n- Cancel an order\. No screen of shop offers to cancel one\.\n/,
    );
    assert.match(messages(outcome), /The plan does not cover what the brief asks: Cancel an order\. No screen of shop offers to cancel one\./);
    assert.deepEqual((await design(replies(valid(3)))).outcome.uncovered, []);
  });
});

describe("the request of a brief", () => {
  it("holds the brief and the domains of the knowledge with what the sources hold of each, whatever the brief, and nothing else of the knowledge", async () => {
    const { server } = await design(replies(valid(3)), { brief: "Follow the orders" });
    const request = requestText(server);
    assert.ok(request.includes("Brief of the developer, in their words:\\n<brief>\\nFollow the orders\\n</brief>"), request);
    assert.match(request, /Knowledge of the applications, by domain:\\n- orders \(Orders\): Placing and following an order\. \d+ /);
    // No element is given: the agent explores the knowledge by levels.
    assert.ok(!request.includes("Elements:") && !request.includes("shop-api: orders"), request);
    assert.ok(
      request.includes(
        "Next: call knowledge_domain on the domain the brief is about, read what it needs, do the brief once on the screens, then call propose_plan.",
      ),
      request,
    );
    // A brief no word of which is in the knowledge is given the same domains.
    const unknown = requestText((await design(replies(valid(3)), { brief: "zebra" })).server);
    assert.match(unknown, /Knowledge of the applications, by domain:\\n- orders \(Orders\)/);
  });
});

describe("brief, criterion 2 — without an accepted plan, no test is run: the session that plans has neither run_test nor propose_test", () => {
  it("runs nothing, keeps nothing, and reminds the agent to submit the plan", async () => {
    const runner = new FakeTestRunner();
    const { outcome, server } = await design(replies([[OPEN]]), { plan: false, runner });
    assert.equal(outcome.ok, false);
    assert.deepEqual([runner.runs, outcome.tests, sessions(server).length], [[], [], 1]);
    assert.deepEqual(
      toolsOffered(server).filter((tool) => tool === "run_test" || tool === "propose_test"),
      [],
    );
    assert.match(messages(outcome), /The agent stopped without an accepted plan; it was reminded to submit one\./);
    const reminder = (server.requests[2]!.body as { messages: { role: string; content: string }[] }).messages
      .filter((message) => message.role === "user")
      .at(-1)!.content;
    assert.ok(
      reminder.endsWith(
        "\n\nYou stopped before the end. No plan is accepted yet.\nNext: read what the brief is about and do it once on the screens, then call propose_plan.",
      ),
      reminder,
    );
  });
});

describe("brief, criterion 3 — the plan is written to a file the design state names, and each test kept names its scenario", () => {
  it("keeps the plan with its brief, and the scenario of each test, in the order of the plan", async () => {
    const { outcome } = await design(replies(valid(3)), { brief: "Test the orders." });
    const state = stateOf(outcome);
    const plan = planOf(outcome);
    assert.deepEqual([plan.brief, plan.scenarios], ["Test the orders.", KEPT]);
    assert.match(readFileSync(outcome.planPath!, "utf8"), /^# Test plan design-20261113T100000Z\n\n- Environment: local\n- Brief: Test the orders\.\n/);
    assert.deepEqual(
      state.tests.map((test) => [test.path, test.scenario]),
      IDS.map((id) => [`apps/shop/tests/orders/listing/${id}.spec.ts`, id]),
    );
  });
});

describe("brief, criterion 4 — a review that refuses the plan stops the task, no test is written, and the journal says so", () => {
  it("creates no branch, writes nothing, refuses every later call, and reminds the agent of nothing", async () => {
    const review: PlanReview = { review: async () => ({ accepted: false, reason: "The scenarios check only screens." }) };
    const runner = new FakeTestRunner();
    const look = { id: "look", name: "shop_goto", arguments: { url: "/orders" } };
    const { outcome, root, server, before } = await design(
      [
        { body: toolCalls(MODEL, [OPEN]) },
        { body: toolCalls(MODEL, [PLAN, run(spec("x"), "r1")]) },
        { body: toolCalls(MODEL, [COVERED]) },
        { body: toolCalls(MODEL, [{ ...PLAN, id: "plan-2" }, look]) },
        { body: answer(MODEL, "Done.") },
      ],
      { plan: false, planReview: review, runner },
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.branch, undefined);
    // The trace of the session is all the design left.
    assert.deepEqual({ ...snapshot(root), status: "" }, { ...before, status: "" });
    assert.deepEqual(
      git(root, "status", "--porcelain", "--untracked-files=all")
        .split("\n")
        .filter((line) => !line.includes(".oqas/index/")),
      [`?? .oqas/traces/${outcome.tracePath!.split("/").at(-1)}`],
    );
    assert.deepEqual(runner.runs, []);
    assert.match(messages(outcome), /The plan was refused: The scenarios check only screens\. The design stops; no test is written\./);
    assert.match(messages(outcome), /No test was written: the plan was refused: The scenarios check only screens\./);
    for (const id of ["plan-2", "look"])
      assert.match(toolResult(server, id), /The plan was refused: The scenarios check only screens\. The design is stopped; call no more tools\./);
    assert.equal(server.requests.length, 5);
  });
});

describe("the plan of a design", () => {
  it("refuses two scenarios of one id, then accepts the plan fixed, and no second plan", async () => {
    const twice = {
      id: "plan-twice",
      name: "propose_plan",
      arguments: { scenarios: ["list-orders", "list-orders", "follow-order"].map((id) => scenario(id)) },
    };
    const again = { ...PLAN, id: "plan-again" };
    const { outcome, server } = await design(replies([[OPEN], [twice], [PLAN], [COVERED], [again], DONE, ...valid(3)]), { plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.equal(
      told(server, "plan-twice"),
      "Refused (PLAN-ID): the id list-orders is given to several scenarios. Give each scenario its own id.\nNothing else was refused.",
    );
    assert.match(messages(outcome), /\[PLAN-ID\] The plan was refused by the harness: the id list-orders/);
    // Once the plan is accepted, the session that plans is over: every call is refused.
    assert.match(toolResult(server, "plan-again"), /The plan is accepted, and this session is over\. Answer with one sentence; call no more tools\./);
    assert.match(messages(outcome), /The plan was accepted: list-orders, place-order, follow-order\./);
  });

  it("reminds an agent that stopped after a refused plan of the codes it was refused for", async () => {
    const twice = {
      id: "plan-twice",
      name: "propose_plan",
      arguments: { scenarios: ["list-orders", "list-orders", "follow-order"].map((id) => scenario(id)) },
    };
    const { server } = await design(replies([[OPEN], [twice]]), { plan: false });
    const reminder = (server.requests[3]!.body as { messages: { role: string; content: string }[] }).messages
      .filter((message) => message.role === "user")
      .at(-1)!.content;
    assert.match(reminder, /\nYou stopped before the end\. The plan was last refused for: PLAN-ID\.\nNext: /);
  });
});

describe("a brief no test can do", () => {
  it("keeps a plan without a scenario that says why, writes no test nor branch, and succeeds", async () => {
    const uncovered = [{ asked: "Change the address of a customer.", reason: "No screen of shop offers to edit an address." }];
    const none = { id: "plan", name: "propose_plan", arguments: { scenarios: [], uncovered } };
    // Asked once to plan an application at a time, the agent confirms that no test can do what the brief asks.
    const again = { ...none, id: "again" };
    const { outcome, root, server } = await design(replies([[OPEN], [none], [again], DONE]), { plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.deepEqual([outcome.tests, outcome.branch, outcome.uncovered], [[], undefined, uncovered]);
    assert.match(told(server, "plan"), /^The plan is not closed yet\. It holds no scenario/);
    assert.match(told(server, "again"), /^The plan was accepted with 0 scenarios: the agent said no test can do what the brief asks\./);
    assert.deepEqual([planOf(outcome).scenarios, planOf(outcome).ended], [[], "none"]);
    assert.match(readFileSync(outcome.planPath!, "utf8"), /\n## Not covered\n/);
    assert.match(messages(outcome), /No test was written: the plan holds no scenario, and says what the brief asks that no test can do\./);
    // Nothing is committed: the test repository is on the branch it was on.
    assert.equal(git(root, "symbolic-ref", "--short", "HEAD"), "main");
    // The session that plans is over once the plan is accepted: no session writes a test.
    assert.equal(server.requests.length, 4);
  });
});

describe("the duplicates of a design", () => {
  it("sets aside the scenarios another covers, by the code then by the agent that reviews the plan in a session of its own, keeps a test that runs what another runs as a duplicate, and succeeds with the tests left", async () => {
    // The scenario seen-orders does and expects what list-orders does; the reviewer finds follow-order in place-order.
    const same = scenario("seen-orders", "other", { data: scenario("list-orders").data });
    const plan = { ...PLAN, arguments: { scenarios: [...IDS.map((id) => scenario(id)), same] } };
    const report = {
      id: "report",
      name: "report_duplicates",
      arguments: { duplicates: [{ id: "follow-order", of: "place-order", reason: "Both follow\nthe same order." }] },
    };
    // The test of place-order comes back as that of list-orders under another title: the agent is warned, and closes it as it is.
    const copied = spec("list-orders").replace('test("list-orders"', 'test("place-order"');
    const { outcome, root } = await design(
      // The review runs in a session of its own while the plan is submitted: its turns come before the next of the agent that plans.
      replies([[OPEN], [plan], [report], DONE, DONE, ...write("list-orders"), [run(copied, "r-copy")], [close("c-1")], [close("c-2")], DONE]),
      { plan: false, reviewPlan: true },
    );
    assert.equal(outcome.ok, true, messages(outcome));
    const recorded = planOf(outcome);
    assert.deepEqual(
      [recorded.scenarios.map((kept) => kept.id), recorded.ended, recorded.setAside!.map((aside) => [aside.id, aside.duplicates, aside.origin.by])],
      [
        ["list-orders", "place-order"],
        "session-end",
        [
          ["follow-order", "place-order", "agent"],
          ["seen-orders", "list-orders", "harness"],
        ],
      ],
    );
    assert.deepEqual(
      outcome.tests.map((test) => [test.path, test.classes.at(-1)!.class, test.duplicates]),
      [
        ["apps/shop/tests/orders/listing/list-orders.spec.ts", "passed", undefined],
        ["apps/shop/tests/orders/listing/place-order.spec.ts", "duplicate", "apps/shop/tests/orders/listing/list-orders.spec.ts"],
      ],
    );
    // The duplicate stays on the branch, and the commit says what it is.
    assert.match(
      git(root, "log", "-1", "--format=%B", BRANCH),
      /- apps\/shop\/tests\/orders\/listing\/place-order\.spec\.ts: duplicate of apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts/,
    );
    assert.match(readFileSync(outcome.planPath!, "utf8"), /\n## Set aside\n/);
    assert.doesNotMatch(messages(outcome), /The design failed/);
  });
});

describe("plans submitted in one turn", () => {
  it("accept one plan only", async () => {
    const other = { id: "plan-other", name: "propose_plan", arguments: { scenarios: ["a-one", "a-two", "a-three"].map((id) => scenario(id)) } };
    const { outcome, server } = await design(replies([[OPEN], [PLAN, COVERED, other], DONE, ...valid(3)]), { plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.equal(outcome.journal.filter((entry) => entry.message.startsWith("The plan was accepted")).length, 1);
    assert.match(toolResult(server, "plan-other"), /The plan is accepted, and this session is over\./);
  });

  it("are refused once the review refused one of them", async () => {
    const review: PlanReview = { review: async () => ({ accepted: false, reason: "Not now." }) };
    const { outcome, server } = await design(
      [{ body: toolCalls(MODEL, [OPEN]) }, { body: toolCalls(MODEL, [PLAN, COVERED, { ...PLAN, id: "plan-2" }]) }, { body: answer(MODEL, "Done.") }],
      { plan: false, planReview: review },
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.journal.filter((entry) => entry.message.startsWith("The plan was refused: Not now.")).length, 1);
    assert.match(toolResult(server, "plan-2"), /The plan was refused: Not now\. The design is stopped/);
  });
});

describe("what a plan may hold", () => {
  it("refuses the value of a declared variable, the plan being written to a file, and cites a source the index does not list", async () => {
    const leaky = {
      id: "plan-leaky",
      name: "propose_plan",
      arguments: {
        scenarios: [scenario("list-orders", "other", { data: [{ value: DB_URL, from: "shop" }] }), scenario("place-order"), scenario("follow-order")],
      },
    };
    const beyond = {
      id: "plan-beyond",
      name: "propose_plan",
      arguments: {
        scenarios: [
          scenario("list-orders", "other", { sources: [{ source: "shop-guide", item: "Guide" }] }),
          scenario("place-order"),
          scenario("follow-order"),
        ],
      },
    };
    const guide = { id: "guide", name: "shop_guide_list_sections", arguments: {} };
    const { outcome, server } = await design(replies([[OPEN], [leaky], [guide], [beyond], DONE, ...valid(3)]), { plan: false });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.match(
      toolResult(server, "plan-leaky"),
      /Refused \(PLAN-SECRET\): the plan holds the value of SHOP_DB_URL\. Leave it out; a test reads it with process\.env\.SHOP_DB_URL\./,
    );
    assert.ok(!messages(outcome).includes(DB_URL));
    assert.deepEqual(planOf(outcome).scenarios[0]!.sources, [{ source: "shop-guide", item: "Guide" }]);
  });

  it("refuses a functional scenario none of whose texts an action of the agent made appear, and accepts it once the agent searched", async () => {
    const found = { result: "The order shows", shows: ["Order 42 of Ada"], absent: [] };
    const functional = (id: string, kase: string, search: number) =>
      scenario(id, "functional", {
        case: kase,
        // A negative scenario holds the input that matches nothing.
        data: kase === "negative" ? [{ value: "zzqx", from: "made-up" }] : [],
        steps: [
          { action: "Open the orders", actions: [1], expects: [] },
          { action: "Search the orders", actions: [search], expects: [found] },
        ],
      });
    /** The plan, whose second steps cite the action that searched. */
    const plan = (id: string, search: number) => ({
      id,
      name: "propose_plan",
      arguments: { scenarios: [functional("list-orders", "nominal", search), functional("place-order", "negative", search), scenario("follow-order")] },
    });
    const { outcome, server } = await design(replies([[OPEN], [plan("seen", 1)], [SEARCH], [plan("done", 2)]]), { plan: false });
    assert.match(
      toolResult(server, "seen"),
      /Refused \(PLAN-RESULT\): no text scenario list-orders expects appeared, or went, after an action of yours on shop\. Do its steps with shop_goto, shop_fill and shop_click/,
    );
    assert.match(toolResult(server, "search"), /Order 42 of Ada/);
    assert.match(told(server, "done"), /^The plan is not closed yet\. It holds 3 scenarios: list-orders, place-order, follow-order\.\n/);
    // The plan kept holds the code of the action each step cites: the sheet of its first scenario gives it, and the text asserted on the element that shows it, a paragraph without a name.
    assert.ok(
      asked(server, 1).includes(
        [
          '  await test.step("1. Open the orders", async () => {',
          '    await page.goto("/orders");',
          "  });",
          '  await test.step("2. Search the orders", async () => {',
          "    await shop.orders.searchButton.click();",
          "    // Expect 2.1: The order shows.",
          '    await expect(page.getByText("Order 42 of Ada", { exact: true })).toBeVisible();',
          "  });",
        ].join("\n"),
      ),
      asked(server, 1),
    );
    assert.deepEqual(planOf(outcome).scenarios[0]!.steps, [
      {
        action: "Open the orders",
        code: ['await page.goto("/orders");'],
        lines: [{ application: "shop", screen: "/orders", code: 'await page.goto("/orders");' }],
        expects: [],
      },
      {
        action: "Search the orders",
        code: ["await shop.orders.searchButton.click();"],
        lines: [{ application: "shop", screen: "/orders", code: 'await page.getByRole("button", { name: "Search", exact: true }).click();' }],
        expects: [{ ...found, elements: [{ text: "Order 42 of Ada", locator: 'page.getByText("Order 42 of Ada", { exact: true })', field: false }] }],
      },
    ]);
    assert.ok(
      readFileSync(outcome.planPath!, "utf8").includes(
        [
          "### Step 2. Search the orders",
          "",
          "```ts",
          "await shop.orders.searchButton.click();",
          "```",
          "",
          "Expect 2.1: The order shows.",
          '- shows "Order 42 of Ada" in `page.getByText("Order 42 of Ada", { exact: true })`',
          "",
        ].join("\n"),
      ),
    );
    // The result of an action gives its number, which the plan cites.
    assert.match(toolResult(server, "search"), /\\"action\\":2/);
  });
});

describe("the element of an expected text", () => {
  it("is checked on the page: several that share a locator are asked about once, and the test asserts on the one accepted, or on any of them by their number", async () => {
    const paired = scenario("list-orders", "other", {
      steps: [{ action: "Open the pairs", actions: [2], expects: [{ result: "The pairs show", shows: ["Open", "Due"], absent: [] }] }],
    });
    const plan = (id: string, accepts?: number[]) => ({
      id,
      name: "propose_plan",
      arguments: { scenarios: [paired, scenario("place-order"), scenario("follow-order")], ...(accepts === undefined ? {} : { accepts }) },
    });
    const pairs = { id: "pairs", name: "shop_goto", arguments: { url: "/pairs" } };
    const sheetOf = (text: string) => text.slice(text.indexOf("import "), text.lastIndexOf("\nNext:"));
    const { server, outcome } = await design(replies([[OPEN], [pairs], [plan("asked")], [plan("answered", [2])], DONE]), { plan: false });
    const due = 'page.getByRole("region", { name: "Late orders" }).getByRole("heading", { name: "Due", exact: true })';
    assert.equal(
      told(server, "asked"),
      [
        "The plan is not accepted yet. The harness looked on the page for the element of each expected text, and asks you about 2 of them, once:",
        'Warning 1: "Open" (scenario list-orders, expect 1.1) is shown by 2 elements of shop, and the harness found no locator of one of them alone. If any of them will do, put 1 in accepts: the test will then assert that one of them at least shows it, or that none is left. Otherwise expect a more precise text, such as the text of the whole row.',
        `Proposal 2: "Due" (scenario list-orders, expect 1.1) is shown by 2 elements of shop. The harness proposes to assert it on one of them alone: ${due}. Check that it is the element you mean: if it is, put 2 in accepts. Otherwise expect a more precise text, such as the text of the whole row.`,
        "Next: call propose_plan again with the plan, what you correct in it, and accepts. What you leave unanswered is asserted on any of its elements, and is not asked again.",
      ].join("\n"),
    );
    const sheet = sheetOf(asked(server, 1));
    assert.ok(
      sheet.includes(
        [
          '    await page.goto("/pairs");',
          "    // Expect 1.1: The pairs show.",
          '    await expect(page.getByRole("heading", { name: "Open", exact: true }).filter({ visible: true })).not.toHaveCount(0);',
          `    await expect(${due}).toBeVisible();`,
        ].join("\n"),
      ),
      sheet,
    );
    assert.match(
      messages(outcome),
      /The agent left warning 1 unanswered: "Open" is asserted on any of the 2 elements page\.getByRole\("heading", \{ name: "Open", exact: true \}\)\.\nThe agent accepted proposal 2: "Due" is asserted on /,
    );
    // The skeleton runs as it is: an assertion by the number of the elements keeps the text of the plan.
    const ran = await design(replies([[OPEN], [pairs], [plan("asked")], [plan("answered", [2])], DONE, [run(sheet, "whole")]]), { plan: false });
    assert.match(told(ran.server, "whole"), /^Run of the file: passed\./);
  });
});

describe("the screens a test relies on", () => {
  it("showed each locator of the test", async () => {
    const invented = spec("list-orders").replace('name: "Orders"', 'name: "Orders to deliver"');
    const far = spec("list-orders").replace("  });\n});", '    await page.getByTestId("zzqx").click();\n  });\n});');
    // The session of a scenario saw only what it looked at itself: it opens the orders before it names an element of them.
    const { outcome, server } = await design(replies([[run(far, "far")], [{ ...OPEN, id: "again" }], [run(invented, "invented")], ...valid(3)]));
    assert.equal(outcome.ok, true, messages(outcome));
    assert.match(
      told(server, "invented"),
      /^Refused \(TEST-LOCATOR\): no screen you looked at showed getByRole\("heading", \{ name: "Orders to deliver" \}\)\.\nClosest elements you saw:\n- heading "Orders" \[level=1\]\n- textbox "Search orders" → [^\n]+\nCopy a locator as given, or take shop_snapshot at that step\.\nNothing else was refused\.$/,
    );
    assert.match(told(server, "far"), /^Refused \(TEST-LOCATOR\): no screen you looked at showed getByTestId\("zzqx"\)\.\nCopy a locator as given/);
    // Opening the page gave the agent what it shows, each element with its locator.
    assert.match(toolResult(server, "open"), /heading .*Orders.*getByRole/);
  });
});
