import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { answer, toolCalls } from "@open-qa-stack/testing";
import type { TestRunner } from "@open-qa-stack/domain";
import {
  MODEL,
  BRANCH,
  git,
  spec,
  type Call,
  tagged,
  scenario,
  IDS,
  OPEN,
  PLAN,
  run,
  close,
  DONE,
  write,
  valid,
  replies,
  look,
  broken,
  FakeTestRunner,
  design,
  messages,
  OVER,
  toolResult,
  told,
  stateOf,
  StepRunner,
} from "./designer-support.ts";

describe("loop, criterion 1 — a test that fails, then is fixed, is run twice and passes", () => {
  it("runs the broken text, then the fixed one, and keeps the test as passed", async () => {
    const runner = new FakeTestRunner();
    const { outcome, server } = await design(replies([[run(broken("list-orders"), "r1")], [look("l1")], ...valid(3)]), { runner });
    assert.deepEqual(
      runner.runs.filter((test) => test.path === "apps/shop/tests/orders/listing/list-orders.spec.ts").map((test) => test.content.includes("BROKEN")),
      [true, false],
    );
    assert.equal(outcome.tests.find((test) => test.path === "apps/shop/tests/orders/listing/list-orders.spec.ts")?.verdict, "passed");
    assert.equal(runner.runs.length, 4, "a scenario is closed with the text of its last run, which is not run again");
    assert.match(
      messages(outcome),
      // The look the repair needs is journaled as one beyond the sheet, after the failed run, and counted once the session is over.
      /The test apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts was run: failed\.\n\[SHEET-BEYOND\] Scenario list-orders, after failed run 1: shop_snapshot\.\nThe test apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts was run: passed\.\n.*\nScenario list-orders: 1 calls beyond its sheet\.\n/,
    );
    assert.match(
      told(server, "r-list-orders"),
      /^Run of the file: passed\.\n- shop › apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts › the test: passed\.\nNext: call propose_test\.$/,
    );
  });
});

describe("loop, criterion 2 — the result told to the agent holds the assertion, the failed step and the trace", () => {
  it("gives the error in full, the step, the trace and the instant to read the logs from", async () => {
    const { server } = await design(replies([[run(broken("list-orders"), "r1")], [look("l1")], ...valid(3)]));
    const told = toolResult(server, "r1");
    for (const part of [
      "Run of the file: failed.",
      "expect(locator).toBeVisible() failed",
      "getByRole('heading', { name: 'Orders' })",
      "Failed step: open the orders",
      "Trace: .oqas/test-results/trace.zip",
      "since 2026-11-13T10:00:00.000Z",
      "Next: look at the page at the failed step",
    ])
      assert.ok(told.includes(part), part);
  });

  it("refuses to run a test the rules refuse, and tells why when a test cannot run", async () => {
    const runner = new FakeTestRunner();
    const { server } = await design(replies([[run(`import fs from "node:fs";\n${spec("list-orders")}`, "r1")], ...valid(3)]), { runner });
    assert.match(toolResult(server, "r1"), /Refused \(TEST-IMPORT\): Line 1 imports node:fs/);
    assert.ok(runner.runs.every((test) => !test.content.includes("node:fs")));
    const failing = new FakeTestRunner("The browsers of Playwright 1.64.1 could not be installed: offline");
    const cannot = await design(replies(valid(1)), { runner: failing });
    assert.match(
      toolResult(cannot.server, "r-list-orders"),
      /Run of the file: it could not run: The browsers of Playwright 1\.64\.1 could not be installed: offline/,
    );
    assert.match(toolResult(cannot.server, "c-list-orders"), /Refused \(PROPOSE-RUN\): scenario list-orders has not run to a verdict\. Call run_test first\./);
    // The test that could not run is not lost: it is kept as unfinished, with what was tried.
    assert.deepEqual(
      [cannot.outcome.tests[0]!.verdict, cannot.outcome.tests[0]!.classes[0]!.class, cannot.outcome.tests[0]!.classes[0]!.reason],
      ["not_run", "unfinished", "Its session ended before the scenario was closed. Tried: 1 run (no verdict); refusals: PROPOSE-RUN ×1."],
    );
    assert.match(messages(cannot.outcome), /The test apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts could not run: The browsers/);
  });
});

describe("loop, criterion 3 — the runs count against the limits, and a test not fixed is never kept as passed", () => {
  it("stops at the limit of iterations, and keeps no test that did not pass", async () => {
    const trials = Array.from({ length: 6 }, (_, i) => ({ body: toolCalls(MODEL, [run(`${broken("list-orders")}// ${i}\n`, `r${i}`)]) }));
    const { outcome } = await design([...trials, { body: answer(MODEL, "Done.") }], { limits: { maxIterations: 3, maxMinutes: 10, maxActions: 200 } });
    assert.match(messages(outcome), /The task reached its iterations limit/);
    assert.deepEqual(outcome.tests, []);
    assert.equal(outcome.ok, false);
  });

  it("refuses to close a scenario whose last run failed without a diagnosis, and one that has not run", async () => {
    const { outcome, server } = await design(replies([[close("early")], [run(broken("list-orders"), "r1")], [close("blind")], [look("l1")], ...valid(3)]));
    assert.match(toolResult(server, "early"), /Refused \(PROPOSE-RUN\): scenario list-orders has not run\. Call run_test first\./);
    assert.match(
      toolResult(server, "blind"),
      /Refused \(PROPOSE-DIAG\): the last run of scenario list-orders failed\. Repair it with run_test \(failed runs: 1 of 3\), or give diagnosis: the cause and what the run showed\./,
    );
    assert.match(messages(outcome), /\[PROPOSE-DIAG\] The scenario list-orders could not be closed: the last run/);
    assert.ok(outcome.tests.every((test) => test.verdict === "passed"));
  });
});

describe("loop, criterion 4 — a failing test is kept with its diagnosis and the harness's verdict", () => {
  it("writes the test with its verdict failed and its quarantine in the state, and counts it only when the application is at fault", async () => {
    const blamed = write("follow-order", broken("follow-order"), { cause: "application", evidence: "The total stays empty although the order has two lines." });
    const { outcome, root, server } = await design(replies([...valid(2), ...blamed]));
    assert.equal(outcome.ok, true, messages(outcome));
    const test = stateOf(outcome).tests.find((candidate) => candidate.scenario === "follow-order");
    assert.deepEqual(test, {
      path: "apps/shop/tests/orders/listing/follow-order.spec.ts",
      scenario: "follow-order",
      verdict: "failed",
      classes: [
        {
          at: "2026-11-13T10:00:00.000Z",
          class: "failing-application",
          origin: { by: "agent", role: "writer" },
          reason: "The total stays empty although the order has two lines.",
        },
      ],
      runs: [{ verdict: "failed", errorClass: "assertion", failedStep: "open the orders" }],
      quarantine: {
        cause: "application",
        evidence: "The total stays empty although the order has two lines.",
        failedStep: "open the orders",
        errorClass: "assertion",
      },
    });
    assert.equal(readFileSync(join(root, "apps", "shop", "tests", "orders", "listing", "follow-order.spec.ts"), "utf8"), tagged(broken("follow-order")));
    assert.match(git(root, "log", "-1", "--format=%B", BRANCH), /- apps\/shop\/tests\/orders\/listing\/follow-order\.spec\.ts: failing \(application\)/);
    assert.equal(told(server, "c-follow-order"), `Scenario follow-order closed: failing (application), kept for a person to decide.\n${OVER}`);
    const own = await design(
      replies([...valid(2), ...write("follow-order", broken("follow-order"), { cause: "plan", evidence: "The heading of the plan is wrong." })]),
    );
    assert.equal(own.outcome.ok, false);
    assert.equal(own.outcome.tests.length, 3);
    assert.match(messages(own.outcome), /The design failed: 2 tests were obtained/);
  });
});

describe("the repair contract", () => {
  it("asks for a look between two failed runs, refuses a text that already failed, and stops a scenario at its third failed run", async () => {
    const failing = (marker: string) => `${broken("list-orders")}// ${marker}\n`;
    const runner = new StepRunner();
    const turns = [
      [run(failing("1"), "f1")],
      [run(failing("2"), "blind")],
      [look("l1")],
      [run(failing("1"), "same")],
      [close("early", { cause: "test", evidence: "The heading never shows." })],
      [run(failing("2"), "f2")],
      [look("l2")],
      [run(`${failing("3")}// LOCATOR\n`, "f3")],
      [close("cause", { cause: "application", evidence: "The search does nothing." })],
      [look("l3")],
      [run(failing("4"), "stop")],
      [close("kept", { cause: "test", evidence: "The search button cannot be reached." })],
      ...valid(3).slice(2),
    ];
    const { outcome, root, server } = await design(replies(turns), { runner });
    assert.match(
      told(server, "f1"),
      /\nThe application shows hidden where the plan expects visible\. The expected text stays\. .*\nFailed runs of list-orders: 1 of 3\.\nNext: look at the page at the failed step, fix the locator or the wait, then call run_test with the whole corrected file \(failed runs: 1 of 3\)\.$/,
    );
    assert.equal(
      told(server, "blind"),
      'Refused (TEST-LOOK): look before you run again. Take shop_snapshot at the step that failed ("open the orders").\nNothing else was refused.',
    );
    assert.equal(
      told(server, "same"),
      "Refused (TEST-SAME): this text already failed, and nothing changed. Fix the locator or the wait the error names, or call propose_test with diagnosis.\nNothing else was refused.",
    );
    assert.match(told(server, "early"), /^Refused \(PROPOSE-EARLY\): failed runs: 1 of 3\. Try a repair with run_test before giving up on the test itself\.\n/);
    assert.match(
      told(server, "f3"),
      /\nThe element is not on the screen at that step\. .*\nFailed runs of list-orders: 3 of 3\.\nNext: call propose_test with diagnosis\.$/,
    );
    assert.match(
      told(server, "cause"),
      /^Refused \(PROPOSE-CAUSE\): cause "application" does not fit: the run failed on locator at step "1\. Open the orders", before any check of the application\. Fix the locator, or give cause "test"\.\n/,
    );
    assert.match(told(server, "stop"), /^Refused \(TEST-STOP\): scenario list-orders failed 3 runs\. Do not run it again\. Call propose_test with diagnosis/);
    assert.match(told(server, "kept"), /^Scenario list-orders closed: failing \(test\), kept for a person to decide\./);
    assert.equal(runner.runs.filter((test) => test.path === "apps/shop/tests/orders/listing/list-orders.spec.ts").length, 3);
    const kept = stateOf(outcome).tests[0]!;
    assert.deepEqual(
      [kept.runs, kept.quarantine],
      [
        [
          { verdict: "failed", errorClass: "assertion", failedStep: "open the orders" },
          { verdict: "failed", errorClass: "assertion", failedStep: "open the orders" },
          { verdict: "failed", errorClass: "locator", failedStep: "1. Open the orders" },
        ],
        { cause: "test", evidence: "The search button cannot be reached.", failedStep: "1. Open the orders", errorClass: "locator" },
      ],
    );
    assert.match(git(root, "log", "-1", "--format=%B", BRANCH), /- apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts: failing \(test\) at step 1\n/);
    assert.match(
      messages(outcome),
      /\[TEST-LOOK\] The test apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts could not be run: look before you run again/,
    );
  });

  it("keeps as unfinished the test of a scenario whose three runs gave no verdict, and counts a read of the code as a look", async () => {
    const offline = new FakeTestRunner("The browsers of Playwright could not be installed: offline");
    const passing = new FakeTestRunner();
    const runner: TestRunner = { run: async (test) => (test.path.endsWith("list-orders.spec.ts") ? offline : passing).run(test) };
    const code = (id: string): Call => ({ id, name: "shop_code_list_files", arguments: {} });
    const turns = [
      [run(spec("a"), "n1")],
      [code("c1")],
      [run(spec("b"), "n2")],
      [look("l1")],
      [run(spec("c"), "n3")],
      [close("gone")],
      DONE,
      ...valid(3).slice(3),
    ];
    const { outcome, root, server } = await design(replies(turns), { runner: runner as FakeTestRunner });
    assert.match(told(server, "n2"), /^Run of the file: it could not run: .*offline\nFailed runs of list-orders: 2 of 3\./);
    assert.equal(told(server, "gone"), `Scenario list-orders closed, its test kept as unfinished: none of its runs gave a verdict.\n${OVER}`);
    assert.match(
      messages(outcome),
      /The scenario list-orders was closed by the harness \(TEST-STOP\): its test is kept as unfinished: apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts\./,
    );
    const [unfinished] = stateOf(outcome).tests;
    assert.deepEqual(
      [offline.runs.length, outcome.tests.map((test) => test.scenario), unfinished!.verdict, unfinished!.closedBy, unfinished!.classes],
      [
        3,
        IDS,
        "not_run",
        "TEST-STOP",
        [
          {
            at: "2026-11-13T10:00:00.000Z",
            class: "unfinished",
            origin: { by: "harness", check: "TEST-STOP" },
            reason: "None of its 3 runs gave a verdict. Tried: 3 runs (no verdict, no verdict, no verdict); no refusal.",
          },
        ],
      ],
    );
    // The file kept is the last one submitted.
    assert.equal(readFileSync(join(root, "apps", "shop", "tests", "orders", "listing", "list-orders.spec.ts"), "utf8"), tagged(spec("c")));
  });

  it("keeps a test failing on another error than an assertion only as the test's fault, with every run, even one that gave no verdict", async () => {
    const runner: TestRunner = {
      run: async (test) =>
        test.content.includes("OFFLINE")
          ? { startedAt: "2026-11-13T10:00:00.000Z", tests: [], error: "offline" }
          : {
              startedAt: "2026-11-13T10:00:00.000Z",
              tests: [{ id: `shop › ${test.path} › t`, verdict: "failed", reason: "ReferenceError: total is not defined" }],
            },
    };
    const text = (marker: string) => `${spec("list-orders")}// ${marker}\n`;
    const turns = [
      [run(text("OFFLINE"), "r0")],
      [look("l0")],
      [run(text("1"), "r1")],
      [close("cause", { cause: "application", evidence: "The total is wrong." })],
      [run(text("2"), "blind")],
      [look("l1")],
      [run(text("3"), "r3")],
      [close("kept", { cause: "test", evidence: "The total cannot be read." })],
    ];
    const { outcome, root, server } = await design(replies(turns), { runner: runner as FakeTestRunner });
    assert.match(
      told(server, "cause"),
      /^Refused \(PROPOSE-CAUSE\): cause "application" does not fit: the run failed on other, before any check of the application\./,
    );
    assert.match(told(server, "blind"), /^Refused \(TEST-LOOK\): look before you run again\. Take shop_snapshot at the step that failed\.\n/);
    const kept = stateOf(outcome).tests[0]!;
    assert.deepEqual(
      [kept.runs, kept.quarantine],
      [
        [{}, { verdict: "failed", errorClass: "other" }, { verdict: "failed", errorClass: "other" }],
        { cause: "test", evidence: "The total cannot be read.", errorClass: "other" },
      ],
    );
    assert.match(git(root, "log", "-1", "--format=%B", BRANCH), /- apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts: failing \(test\)$/m);
  });

  it("tells a look at an application without a user interface by the tools of its sources, any of which counts", async () => {
    const cited = { application: "ledger", sources: [{ source: "shop-guide" }] };
    const ledger = { ...PLAN, arguments: { scenarios: IDS.map((id) => scenario(id, "other", cited)) } };
    const contract: Call = { id: "contract", name: "shop_guide_list_sections", arguments: {} };
    const turns = [
      [OPEN, { ...contract, id: "read" }],
      [ledger],
      DONE,
      [run(broken("list-orders"), "f1")],
      [run(`${broken("list-orders")}// 2\n`, "blind")],
      [contract],
      [run(`${broken("list-orders")}// 3\n`, "f2")],
    ];
    const { server } = await design(replies(turns), { plan: false });
    assert.equal(
      told(server, "blind"),
      'Refused (TEST-LOOK): look before you run again. Read the source code with shop_code_list_files, at the step that failed ("open the orders").\nNothing else was refused.',
    );
    assert.match(told(server, "f2"), /^Run of the file: failed\./);
  });

  it("counts a call of any browser tool of the application as a look", async () => {
    const console: Call = { id: "console", name: "shop_console", arguments: {} };
    const { server } = await design(replies([[run(broken("list-orders"), "f1")], [console], [run(`${broken("list-orders")}// 2\n`, "f2")]]));
    assert.match(told(server, "f2"), /^Run of the file: failed\./);
  });

  it("runs the calls of one turn one after the other, each seeing the run the previous recorded", async () => {
    const runner = new FakeTestRunner();
    const failing = (marker: string) => `${broken("list-orders")}// ${marker}\n`;
    const { outcome, server } = await design(
      replies([[run(failing("1"), "f1")], [look("l1")], [run(failing("2"), "f2")], [look("l2")], [run(failing("3"), "t1"), run(failing("3"), "t2")]]),
      { runner },
    );
    assert.match(told(server, "t1"), /\nFailed runs of list-orders: 3 of 3\.\n/);
    assert.match(told(server, "t2"), /^Refused \(TEST-STOP\): .*\nRefused \(TEST-SAME\): .*\nRefused \(TEST-LOOK\): /);
    assert.equal(runner.runs.length, 3);
    assert.match(messages(outcome), /\[TEST-SAME\] The test apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts could not be run/);
  });

  it("keeps the last run that gave a verdict when the last of all gave none", async () => {
    const runner: TestRunner = {
      run: async (test) =>
        test.content.includes("OFFLINE") ? { startedAt: "2026-11-13T10:00:00.000Z", tests: [], error: "offline" } : new FakeTestRunner().run(test),
    };
    const failing = (marker: string) => `${broken("list-orders")}// ${marker}\n`;
    const turns = [
      [run(failing("1"), "f1")],
      [look("l1")],
      [run(failing("2"), "f2")],
      [look("l2")],
      [run(failing("OFFLINE"), "f3")],
      [close("kept", { cause: "application", evidence: "The heading never shows." })],
    ];
    const { outcome, root, server } = await design(replies(turns), { runner: runner as FakeTestRunner });
    assert.match(told(server, "kept"), /^Scenario list-orders closed: failing \(application\), kept for a person to decide\./);
    const kept = stateOf(outcome).tests[0]!;
    assert.deepEqual([kept.runs.length, kept.quarantine?.cause], [3, "application"]);
    assert.equal(readFileSync(join(root, "apps", "shop", "tests", "orders", "listing", "list-orders.spec.ts"), "utf8"), tagged(failing("2")));
  });
});
