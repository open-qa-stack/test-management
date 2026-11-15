import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { answer, toolCalls } from "@open-qa-stack/testing";
import {
  MODEL,
  BRANCH,
  git,
  repository,
  snapshot,
  spec,
  tagged,
  scenario,
  IDS,
  OPEN,
  SEARCH,
  PLAN,
  COVERED,
  KEPT,
  run,
  DONE,
  write,
  valid,
  replies,
  broken,
  design,
  messages,
  filesOf,
  toolsOffered,
  requestText,
  sessions,
  firstMessage,
  asked,
  OVER,
  PASSED,
  toolResult,
  told,
  stateOf,
  planOf,
  specsOf,
} from "./designer-support.ts";

describe("criterion 1 — three valid tests are written on a new branch, in the folder of their application, with a state", () => {
  it("writes exactly three spec files and the state that lists them, commits them on the branch, and stays on it", async () => {
    const { outcome, root, server } = await design(replies(valid(3)));
    assert.equal(outcome.ok, true);
    assert.equal(git(root, "branch", "--show-current"), BRANCH);
    assert.deepEqual(specsOf(root), [
      "apps/shop/tests/orders/listing/follow-order.spec.ts",
      "apps/shop/tests/orders/listing/list-orders.spec.ts",
      "apps/shop/tests/orders/listing/place-order.spec.ts",
    ]);
    assert.equal(readFileSync(join(root, "apps", "shop", "tests", "orders", "listing", "list-orders.spec.ts"), "utf8"), tagged(spec("list-orders")));
    // The fixtures the tests import are written for a repository that has none, and committed with them.
    assert.ok(filesOf(root).includes("apps/shared/fixtures.ts"));
    assert.match(readFileSync(join(root, "apps", "shared", "fixtures.ts"), "utf8"), /^export const test = base\.extend<Applications>\(\{\n {2}shop: /m);
    // So is the file that gathers the page objects of each application the fixtures give.
    assert.ok(filesOf(root).includes("apps/shop/pages/index.ts"));
    const state = stateOf(outcome);
    assert.equal(outcome.statePath, join(root, ".oqas", "designs", "design-20261113T100000Z.json"));
    assert.equal(outcome.planPath, join(root, ".oqas", "designs", "design-20261113T100000Z.plan.md"));
    for (const file of ["design-20261113T100000Z.json", "design-20261113T100000Z.plan.md"]) assert.ok(filesOf(root).includes(`.oqas/designs/${file}`), file);
    assert.deepEqual(
      state.tests,
      IDS.map((id) => ({
        path: `apps/shop/tests/orders/listing/${id}.spec.ts`,
        scenario: id,
        verdict: "passed",
        classes: PASSED,
        runs: [{ verdict: "passed" }],
      })),
    );
    assert.deepEqual([state.formatVersion, state.plan, state.brief], [4, ".oqas/designs/design-20261113T100000Z.plan.md", undefined]);
    assert.deepEqual(planOf(outcome), {
      formatVersion: 2,
      design: "design-20261113T100000Z",
      environment: "local",
      scenarios: KEPT,
      // The agent ended its session once the harness asked what was left to cover: the plan was closed with its scenarios.
      ended: "session-end",
    });
    assert.deepEqual(outcome.tests, state.tests);
    assert.deepEqual(
      [state.branch, state.base, state.environment, state.producedAt, state.model.model],
      [BRANCH, git(root, "rev-parse", "main"), "local", "2026-11-13T10:00:00.000Z", MODEL],
    );
    assert.deepEqual(git(root, "log", "-1", "--format=%an <%ae>%n%B", BRANCH).split("\n").slice(0, 4), [
      "Test Maintainer <maintainer@example.com>",
      "test: add 3 generated Playwright tests",
      "",
      "- apps/shop/tests/orders/listing/list-orders.spec.ts: The list-orders scenario",
    ]);
    assert.match(
      messages(outcome),
      /The plan was written to \.oqas\/designs\/design-20261113T100000Z\.plan\.md\.\nThe design state was written to \.oqas\/designs\/design-20261113T100000Z\.json\.\nThe tests were committed on oqas\/design-test; the active branch of the test repository is oqas\/design-test\./,
    );
    assert.equal(git(root, "status", "--porcelain", "--untracked-files=no"), "");
    // The session that plans, then one per scenario: each ends with an answer of the agent.
    assert.equal(server.requests.length, 12);
    assert.deepEqual(
      sessions(server).map((body) => firstMessage(body).split("\n")[0]),
      ["Plan Playwright tests for the environment local.", ...IDS.map(() => "Write the test of this scenario for the environment local.")],
    );
  });

  it("gives the agent the charter, the domains of the index and its tools, the screens, every source of the environment and the notes", async () => {
    const { server } = await design(replies(valid(3)));
    const tools = toolsOffered(server);
    // The session that plans runs no test; that of a scenario submits no plan.
    assert.ok(
      ["shop_goto", "propose_plan", "remember", "recall", "knowledge_domain", "knowledge_list", "knowledge_read"].every((tool) => tools.includes(tool)),
    );
    assert.deepEqual(
      tools.filter((tool) => tool === "run_test" || tool === "propose_test"),
      [],
    );
    const writing = sessions(server)[1]!.tools.map((tool) => tool.function.name);
    // The session of a scenario has the screens of its application, the sources it cites, those that tell why a run failed, and the notes to read.
    assert.ok(["shop_goto", "shop_code_list_files", "run_test", "propose_test", "recall"].every((tool) => writing.includes(tool)));
    // It has the reference of Playwright at the version installed; the session that plans writes no code, and has none.
    assert.deepEqual(
      [writing.filter((tool) => tool.startsWith("playwright_")), tools.filter((tool) => tool.startsWith("playwright_"))],
      [["playwright_search", "playwright_read"], []],
    );
    assert.deepEqual(
      writing.filter((tool) => tool === "propose_plan" || tool === "remember" || /^(index|shop_db|shop_api|order_specs|ledger_api)_/.test(tool)),
      [],
    );
    for (const source of ["order_specs_", "shop_guide_", "shop_api_", "ledger_api_", "shop_db_query"])
      assert.ok(
        tools.some((tool) => tool.startsWith(source)),
        source,
      );
    assert.deepEqual(
      tools.filter((tool) => /^(staging_specs|legacy)_/.test(tool)),
      [],
    );
    const described = new Map(
      (server.requests[0]!.body as { tools: { function: { name: string; description: string } }[] }).tools.map((tool) => [
        tool.function.name,
        tool.function.description,
      ]),
    );
    assert.match(described.get("shop_db_search")!, /Read-only\. A value of the data of a plan comes from a result such as this one\.$/);
    assert.doesNotMatch(described.get("shop_db_query")!, /data of a plan/);
    assert.match(
      described.get("shop_goto")!,
      /Returns what the page shows, the line of code that does the same in a test, and "action", its number: a plan cites it in the steps the action does\.$/,
    );
    assert.match(described.get("propose_plan")!, /in actions the numbers of the browser actions that did it when you explored/);
    assert.match(
      sessions(server)[1]!.tools.find((tool) => tool.function.name === "run_test")!.function.description,
      /^Checks the test of the open scenario against the plan, then runs it/,
    );
    assert.match(described.get("propose_plan")!, /The harness refuses a value or a text no tool showed you\.$/);
    const request = requestText(server);
    for (const fragment of [
      "You plan the tests of the applications of one test environment.",
      "No brief was given",
      "- orders (Orders): Placing and following an order.",
      "- customers (Customers): The customers of the shop.",
      "- shop (Shop, web-and-api): sign in with shop_fill and the account demo.",
      "- ledger (Ledger, api): no sign-in.",
      "Next: call knowledge_domain on the domains above that matter most, read what they hold, do it once on the screens, then call propose_plan.",
    ]) {
      assert.ok(request.includes(JSON.stringify(fragment).slice(1, -1)), fragment);
    }
    assert.ok(!request.includes("Legacy"));
    // The agent that plans is given nothing of the charter nor of what a test may import; the agent that writes is.
    assert.ok(!request.includes("PW-WAIT-01") && !request.includes("A test may import"));
    const written = JSON.stringify(sessions(server)[1]);
    for (const fragment of [
      "You write the Playwright test of one scenario of an accepted plan",
      "PW-WAIT-01",
      "Sign-in: with the account demo; the lines of the sheet that sign in read it from process.env: keep them as they are.",
      "A test may import: apps/shared/fixtures.ts.",
      "Intent: Verifies list-orders.",
      "Cited: shop: /orders.",
    ])
      assert.ok(written.includes(JSON.stringify(fragment).slice(1, -1)), fragment);
    assert.ok(!written.includes("You plan the tests"));
    // The index is looked up, not given whole.
    assert.ok(!request.includes("Lists and places the orders of a customer."));
  });

  it("names the branch after the date by default, ends the file with a new line, and leaves out a state and a plan git ignores", async () => {
    const root = repository();
    writeFileSync(join(root, ".gitignore"), ".oqas/\n");
    git(root, "add", ".gitignore");
    git(root, "commit", "-q", "-m", "chore: ignore the state");
    const { outcome } = await design(replies([...valid(2), ...write("follow-order", spec("follow-order").trimEnd())]), { root, branch: null });
    assert.match(outcome.branch!, /^oqas\/design-\d{8}T\d{6}Z$/);
    assert.equal(readFileSync(join(root, "apps", "shop", "tests", "orders", "listing", "follow-order.spec.ts"), "utf8"), tagged(spec("follow-order")));
    assert.ok(!filesOf(root, outcome.branch).some((path) => path.startsWith(".oqas/")));
    assert.ok(existsSync(outcome.statePath!));
    assert.ok(existsSync(outcome.planPath!));
    assert.match(
      messages(outcome),
      /The plan was written to \.oqas\/designs\/design-\w+\.plan\.md, which git ignores: it was not committed\.\nThe design state was written to \.oqas\/designs\/design-\w+\.json, which git ignores: it was not committed\./,
    );
  });
});

describe("how the tests are built, as the configuration says", () => {
  /** A plan whose first scenario clicks an element of the orders. */
  const clicking = {
    ...PLAN,
    arguments: {
      scenarios: [scenario("list-orders", "other", { steps: [{ action: "Search", actions: [1, 2], expects: [] }] }), ...IDS.slice(1).map((id) => scenario(id))],
    },
  };
  const script = [
    { body: toolCalls(MODEL, [OPEN]) },
    { body: toolCalls(MODEL, [SEARCH]) },
    { body: toolCalls(MODEL, [clicking]) },
    { body: answer(MODEL, "Done.") },
  ];
  const CLICK = 'await page.getByRole("button", { name: "Search", exact: true }).click();';

  it("writes each test on its own, importing Playwright itself, and nothing beside it, for a repository with an architecture of its own", async () => {
    const alone = (id: string) => write(id, spec(id).replace('from "../../../../shared/fixtures.ts"', 'from "@playwright/test"'));
    const { outcome, root, server } = await design([...script, ...replies(IDS.flatMap(alone))], { plan: false, architecture: "standalone" });
    assert.equal(outcome.tests.length, 3, messages(outcome));
    assert.deepEqual(
      filesOf(root).filter((path) => path.startsWith("apps/") && !path.endsWith(".spec.ts")),
      [],
    );
    assert.match(asked(server, 1), /\nA test may import: @playwright\/test\.\n/);
    assert.ok(asked(server, 1).includes(`import { expect, test } from "@playwright/test";`) && asked(server, 1).includes(`    ${CLICK}\n`), asked(server, 1));
  });

  it("gives the tests the fixtures they share and leaves each line on the page, when no page object is asked for", async () => {
    const { outcome, root, server } = await design([...script, ...replies(valid(3))], { plan: false, architecture: "fixtures" });
    assert.equal(outcome.tests.length, 3, messages(outcome));
    assert.ok(filesOf(root).includes("apps/shared/fixtures.ts") && filesOf(root).includes("apps/shop/pages/index.ts"));
    assert.ok(
      asked(server, 1).includes(`import { expect, test } from "../../../../shared/fixtures.ts";`) && asked(server, 1).includes(`    ${CLICK}\n`),
      asked(server, 1),
    );
  });
});

describe("a plan of visual tests alone", () => {
  it("is asked of the agent, held to visual scenarios, and each ends with the comparison the harness adds", async () => {
    const state = { ...PLAN, arguments: { scenarios: [scenario("orders-as-opened", "visual")] } };
    const script = [
      { body: toolCalls(MODEL, [OPEN]) },
      { body: toolCalls(MODEL, [state]) },
      { body: toolCalls(MODEL, [COVERED]) },
      { body: answer(MODEL, "Done.") },
    ];
    const { outcome, server } = await design([...script, ...replies([])], { plan: false, visual: true });
    assert.match(JSON.stringify(server.requests[0]!.body), /This plan is of visual tests alone/);
    assert.deepEqual(
      planOf(outcome).scenarios.map((kept) => [kept.id, kept.steps.at(-1)!.screenshot]),
      [["orders-as-opened", { tolerance: 0.01 }]],
    );
    assert.ok(
      asked(server, 1).includes('await expect(page).toHaveScreenshot({ fullPage: true, animations: "disabled", maxDiffPixelRatio: 0.01 });'),
      asked(server, 1),
    );
  });
});

describe("criterion 2 — each scenario of a plan gives one test", () => {
  it("writes the four tests of a plan of four scenarios, then refuses any further call", async () => {
    const four = { ...PLAN, arguments: { scenarios: [...IDS, "cancel-order"].map((id) => scenario(id)) } };
    const after = run(spec("late"), "late");
    const { outcome, root, server } = await design(
      [{ body: toolCalls(MODEL, [OPEN]) }, { body: toolCalls(MODEL, [four]) }, ...replies([DONE, ...valid(3), ...write("cancel-order").slice(0, 2), [after]])],
      { plan: false },
    );
    assert.equal(outcome.tests.length, 4);
    assert.equal(specsOf(root).length, 4);
    assert.equal(told(server, "c-cancel-order"), `Scenario cancel-order closed: passed.\n${OVER}`);
    assert.match(
      toolResult(server, "late"),
      /Refused \(SCENARIO-CLOSED\): the scenario of this session is closed\. Answer with one sentence; call no more tools\./,
    );
  });
});

describe("criterion 3 — with two valid tests the design fails, the journal says 2, and both files are on the branch", () => {
  it("reminds the agent, then keeps the two tests, and the skeleton of the third as an unfinished test, and fails", async () => {
    const { outcome, root, server } = await design(replies(valid(2)));
    assert.equal(outcome.ok, false);
    assert.match(messages(outcome), /The design failed: 2 tests were obtained, 3 are expected, one per scenario of the plan\./);
    assert.match(messages(outcome), /The agent stopped before scenario follow-order was closed; it was reminded to go on\./);
    assert.match(
      messages(outcome),
      /The scenario follow-order was closed by the harness \(SESSION-END\): its test is kept as unfinished: apps\/shop\/tests\/orders\/listing\/follow-order\.spec\.ts\./,
    );
    // No test is lost: the scenario the agent left keeps a file, classed as unfinished, which does not count.
    assert.deepEqual(specsOf(root), [
      "apps/shop/tests/orders/listing/follow-order.spec.ts",
      "apps/shop/tests/orders/listing/list-orders.spec.ts",
      "apps/shop/tests/orders/listing/place-order.spec.ts",
    ]);
    assert.match(
      readFileSync(join(root, "apps", "shop", "tests", "orders", "listing", "follow-order.spec.ts"), "utf8"),
      /^import \{ expect, test \} from "\.\.\/\.\.\/\.\.\/\.\.\/shared\/fixtures\.ts";\n\ntest\("The follow-order scenario"/,
    );
    assert.deepEqual(stateOf(outcome).tests[2], {
      path: "apps/shop/tests/orders/listing/follow-order.spec.ts",
      scenario: "follow-order",
      verdict: "not_run",
      classes: [
        {
          at: "2026-11-13T10:00:00.000Z",
          class: "unfinished",
          origin: { by: "harness", check: "SESSION-END" },
          reason: "Its session ended before the scenario was closed. Tried: no run; no refusal.",
        },
      ],
      runs: [],
      closedBy: "SESSION-END",
    });
    assert.match(git(root, "log", "-1", "--format=%B", BRANCH), /- apps\/shop\/tests\/orders\/listing\/follow-order\.spec\.ts: unfinished \(SESSION-END\)/);
    const reminder = (server.requests.at(-1)!.body as { messages: { role: string; content: string }[] }).messages
      .filter((message) => message.role === "user")
      .at(-1)!.content;
    assert.match(
      reminder,
      /\nYou stopped before the end\. Scenario 3 of 3, follow-order: its test has not run\.\nNext: check the skeleton of follow-order against its steps, complete what a comment asks, then call run_test with the whole file\./,
    );
  });

  it("reminds an agent that stopped of where the scenario open stands", async () => {
    const done = { body: answer(MODEL, "Done.") };
    const { server } = await design([
      { body: toolCalls(MODEL, [run(spec("list-orders"), "r1")]) },
      done,
      { body: toolCalls(MODEL, [run(broken("list-orders"), "r2")]) },
      done,
      done,
      done,
    ]);
    const reminders = server.requests.flatMap((request) =>
      (request.body as { messages: { role: string; content: string }[] }).messages
        .filter((message) => message.role === "user")
        .slice(1)
        .map((message) => message.content.split("\n\n").at(-1)!),
    );
    assert.deepEqual(
      [...new Set(reminders)],
      [
        "You stopped before the end. Scenario 1 of 3, list-orders: its test passed and is not closed.\nNext: call propose_test.",
        "You stopped before the end. Scenario 1 of 3, list-orders: its last run failed (1 of 3).\nNext: look at the page at the failed step, fix the locator or the wait, then call run_test with the whole corrected file (failed runs: 1 of 3).",
      ],
    );
  });

  it("writes nothing and creates no branch when no test was obtained, the session failing", async () => {
    const { outcome, root, before } = await design([{ status: 500, body: { error: { message: "down" } } }]);
    assert.equal(outcome.ok, false);
    assert.match(messages(outcome), /The session failed: .*\n[^]*No test was written: 0 tests were obtained/);
    assert.deepEqual(snapshot(root).branches, before.branches);
    // The fixtures written for the tests of this design go with them: nothing is left that no commit holds.
    assert.equal(existsSync(join(root, "apps", "shared", "fixtures.ts")), false);
    assert.doesNotMatch(git(root, "status", "--porcelain", "--untracked-files=all"), /fixtures/);
  });
});
