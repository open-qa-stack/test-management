import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import {
  BRANCH,
  PASSWORD,
  git,
  repository,
  spec,
  type Call,
  IDS,
  OPEN,
  run,
  close,
  DONE,
  valid,
  replies,
  look,
  broken,
  design,
  messages,
  filesOf,
  toolsOffered,
  requestText,
  sessions,
  firstMessage,
  told,
  stateOf,
  planOf,
  specsOf,
} from "./designer-support.ts";

describe("the trace of a design", () => {
  const lines = (path: string) =>
    readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as { phase: string; actor: string; event: { type: string; outcome?: string; tool?: string; text?: string; message?: string } },
      );

  it("holds the request, each call of the agent with its result, the journal, and ends as done", async () => {
    const seen: string[] = [];
    const { outcome } = await design(replies(valid(3)), { observe: (line) => seen.push(line.event.type) });
    const trace = lines(outcome.tracePath!);
    // One phase for the session that plans, then one for the session of each scenario, each with what it asked of the model.
    const of = (type: string) => trace.filter((line) => line.actor === "harness" && line.event.type === type);
    assert.deepEqual(
      of("started").map((line) => line.phase),
      ["plan", "write", "write", "write"],
    );
    assert.deepEqual(
      of("finished").map((line) => [line.phase, line.event.outcome]),
      [
        ["plan", "done"],
        ["write", "done"],
        ["write", "done"],
        ["write", "done"],
      ],
    );
    assert.deepEqual(
      of("usage").map((line) => [line.phase, (line.event as { requests?: number }).requests]),
      [
        ["plan", 3],
        ["write", 3],
        ["write", 3],
        ["write", 3],
      ],
    );
    assert.equal(trace[0]!.event.type, "started");
    assert.deepEqual(
      of("message").map((line) => line.event.text!.split("\n")[0]),
      ["Plan Playwright tests for the environment local.", ...IDS.map(() => "Write the test of this scenario for the environment local.")],
    );
    // The journal is traced in the phase it was written in.
    assert.deepEqual(
      trace
        .filter((line) => line.event.type === "journal" && /^The (plan was accepted|scenario list-orders was opened)/.test(line.event.message!))
        .map((line) => line.phase),
      ["plan", "write"],
    );
    assert.deepEqual(
      trace.filter((line) => line.actor === "agent" && line.event.type === "tool-call").map((line) => line.event.tool),
      ["shop_goto", "propose_plan", ...IDS.flatMap(() => ["run_test", "propose_test"])],
    );
    assert.ok(
      trace.some(
        (line) =>
          line.event.type === "journal" &&
          line.event.message === "The scenario list-orders was closed: passed; its test is apps/shop/tests/orders/listing/list-orders.spec.ts.",
      ),
    );
    assert.equal(seen.length, trace.length);
    assert.ok(!readFileSync(outcome.tracePath!, "utf8").includes(PASSWORD));
  });

  it("ends a phase as truncated when a limit cut its session, as failed when the session did not give what it was for, and is not opened without a session", async () => {
    const late = (id: string) => run(spec("late"), id);
    const cut = await design(replies([...valid(3).slice(0, 8), [late("l1")], [late("l2")], [late("l3")]]), {
      limits: { maxIterations: 4, maxMinutes: 10, maxActions: 200 },
    });
    assert.equal(cut.outcome.ok, true, messages(cut.outcome));
    const outcomes = (path: string) =>
      lines(path)
        .filter((line) => line.event.type === "finished")
        .map((line) => line.event.outcome);
    assert.deepEqual(outcomes(cut.outcome.tracePath!), ["done", "done", "done", "truncated"]);
    // The limit cut nothing of the plan: every scenario was closed before it.
    assert.equal(cut.outcome.stoppedBy, undefined);
    // The session of a scenario the agent left open did not give its test.
    const few = await design(replies(valid(2)));
    assert.deepEqual(outcomes(few.outcome.tracePath!), ["done", "done", "done", "failed"]);
    const none = await design(replies([]), { plan: false });
    assert.deepEqual(outcomes(none.outcome.tracePath!), ["failed"]);
    const dirty = repository();
    writeFileSync(join(dirty, "specs", "orders.md"), "changed\n");
    const stopped = await design(replies(valid(3)), { root: dirty });
    assert.equal(stopped.outcome.tracePath, undefined);
    assert.ok(!existsSync(join(dirty, ".oqas", "traces")));
  });
});

describe("resume — a design a limit stopped goes on from its plan and its tests, on its branch", () => {
  /** The relative path of the state of the design of the helper. */
  const STATE = ".oqas/designs/design-20261113T100000Z.json";
  /** A design the limit of a session stopped: the plan is accepted, the first test kept, the second run but not closed when its session reaches its fourth model call. */
  const stopped = (brief?: string) =>
    design(replies([...valid(1), [run(spec("place-order"), "r-place-order")], [look("l1")], [look("l2")], [look("l3")]]), {
      limits: { maxIterations: 4, maxMinutes: 10, maxActions: 200 },
      ...(brief === undefined ? {} : { brief }),
    });

  it("keeps the plan and the test of a design a limit stopped, and names the limit", async () => {
    const { outcome, root } = await stopped();
    assert.deepEqual([outcome.ok, outcome.stoppedBy, outcome.branch], [false, "iterations", BRANCH]);
    assert.deepEqual(specsOf(root), ["apps/shop/tests/orders/listing/list-orders.spec.ts"]);
    const state = stateOf(outcome);
    assert.deepEqual([planOf(outcome).scenarios.map((scenario) => scenario.id), state.tests.map((test) => test.scenario)], [IDS, ["list-orders"]]);
  });

  it("gives each session the sheet of its scenario alone, offers no plan tool, and ends on the same branch with every test, written from the sheets without a look at a screen", async () => {
    const first = await stopped();
    const before = git(first.root, "rev-parse", BRANCH);
    git(first.root, "switch", "--quiet", "main");
    // The session resumed opens no page: the code and the locators of its tests are those its sheets give, from the plan.
    const { outcome, root, server } = await design(replies(valid(3).slice(3)), {
      root: first.root,
      plan: false,
      resume: { state: STATE, branch: BRANCH },
    });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.equal(outcome.stoppedBy, undefined);
    const request = requestText(server);
    // The first session is that of the first scenario not closed: it is given neither the plan nor the test kept.
    assert.ok(!request.includes("list-orders"));
    assert.match(request, /Scenario 2 of 3: place-order/);
    assert.deepEqual(
      sessions(server).map((body) => /Scenario \d of 3: [a-z-]+/.exec(firstMessage(body))?.[0]),
      ["Scenario 2 of 3: place-order", "Scenario 3 of 3: follow-order"],
    );
    assert.ok(
      request.includes(
        JSON.stringify(
          '    await page.goto("/orders");\n    // Expect 1.1: The orders show.\n    await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();',
        ).slice(1, -1),
      ),
    );
    assert.ok(!toolsOffered(server).includes("propose_plan"));
    assert.equal(git(root, "branch", "--show-current"), BRANCH);
    assert.deepEqual(specsOf(root), [
      "apps/shop/tests/orders/listing/follow-order.spec.ts",
      "apps/shop/tests/orders/listing/list-orders.spec.ts",
      "apps/shop/tests/orders/listing/place-order.spec.ts",
    ]);
    assert.equal(git(root, "rev-parse", `${BRANCH}~1`), before);
    const state = stateOf(outcome);
    assert.equal(outcome.statePath, join(root, STATE));
    assert.deepEqual(
      state.tests.map((test) => test.scenario),
      IDS,
    );
    assert.deepEqual([state.plan, outcome.planPath], [stateOf(first.outcome).plan, first.outcome.planPath]);
    assert.deepEqual(planOf(outcome), planOf(first.outcome));
    assert.ok(filesOf(root).includes(state.plan));
    // What every session used, those of the design resumed included.
    assert.equal(state.run.iterations, 3 + 3 + 4 + 3 + 3);
  });

  it("keeps a plan accepted without a test, with no branch, and creates the branch once the design resumed writes one", async () => {
    const first = await design(replies([[run(spec("list-orders"), "r1")], [look("l1")], [look("l2")], [look("l3")]]), {
      limits: { maxIterations: 4, maxMinutes: 10, maxActions: 200 },
    });
    assert.deepEqual([first.outcome.stoppedBy, first.outcome.branch, first.outcome.tests], ["iterations", undefined, []]);
    assert.match(
      messages(first.outcome),
      /The design state was written to \S+\.json, and its plan to \S+\.plan\.md; no new test was written, and nothing was committed\./,
    );
    assert.equal(git(first.root, "branch", "--list", BRANCH), "");
    // The revision checked out moves before the design is resumed: the branch starts from where it is now.
    writeFileSync(join(first.root, "notes.md"), "Notes.\n");
    git(first.root, "add", "notes.md");
    git(first.root, "commit", "--quiet", "-m", "docs: add notes");
    const head = git(first.root, "rev-parse", "HEAD");
    assert.notEqual(stateOf(first.outcome).base, head);
    const again = await design(replies(valid(3)), { root: first.root, plan: false, resume: { state: STATE, branch: BRANCH } });
    assert.equal(again.outcome.ok, true, messages(again.outcome));
    assert.match(requestText(again.server), /Scenario 1 of 3: list-orders/);
    assert.equal(specsOf(again.root).length, 3);
    assert.ok(filesOf(again.root).includes(stateOf(again.outcome).plan), "the plan is committed with the first tests");
    assert.equal(stateOf(again.outcome).base, head);
    assert.equal(git(again.root, "rev-parse", `${BRANCH}~1`), head);
  });

  it("keeps the brief of the design, in its state and in the file of its plan", async () => {
    const first = await stopped("Test the orders.");
    const { outcome } = await design(replies(valid(3).slice(3)), { root: first.root, plan: false, resume: { state: STATE, branch: BRANCH } });
    const state = stateOf(outcome);
    assert.deepEqual([state.brief, planOf(outcome).brief, state.tests.map((test) => test.scenario)], ["Test the orders.", "Test the orders.", IDS]);
  });

  it("names the limit that stops a design before its plan, and writes nothing", async () => {
    const { outcome, root } = await design(replies([[OPEN]]), { plan: false, limits: { maxIterations: 1, maxMinutes: 10, maxActions: 200 } });
    assert.deepEqual([outcome.ok, outcome.stoppedBy, outcome.statePath], [false, "iterations", undefined]);
    assert.ok(!existsSync(join(root, ".oqas", "designs")));
  });

  it("commits nothing when the design resumed is stopped again before a new test", async () => {
    const first = await stopped();
    const before = git(first.root, "rev-parse", BRANCH);
    const { outcome } = await design(replies([[look("l1")], [look("l2")]]), {
      root: first.root,
      plan: false,
      resume: { state: STATE, branch: BRANCH },
      limits: { maxIterations: 1, maxMinutes: 10, maxActions: 200 },
    });
    assert.deepEqual([outcome.stoppedBy, outcome.tests.length], ["iterations", 1]);
    assert.equal(git(first.root, "rev-parse", BRANCH), before);
    assert.equal(stateOf(outcome).run.iterations, 3 + 3 + 4 + 1);
  });

  it("refuses a state it cannot read, or of an earlier format, and a plan missing, or that a hand changed", async () => {
    const missing = await design([], { plan: false, resume: { state: ".oqas/designs/none.json" } });
    assert.match(messages(missing.outcome), /The design state \.oqas\/designs\/none\.json cannot be read; the design was not resumed\./);
    const first = await stopped();
    const state = join(first.root, STATE);
    const plan = first.outcome.planPath!;
    const again = () => design([], { root: first.root, plan: false, resume: { state: STATE, branch: BRANCH } });
    const accepted = readFileSync(plan, "utf8");
    writeFileSync(plan, accepted.replace("Open the orders", "Open the list of the orders"));
    const edited = await again();
    assert.match(
      messages(edited.outcome),
      /The plan \.oqas\/designs\/design-20261113T100000Z\.plan\.md of the design state \.oqas\/designs\/design-20261113T100000Z\.json cannot be read; the design was not resumed\./,
    );
    rmSync(plan);
    assert.match(messages((await again()).outcome), /The plan \S+ of the design state \S+ cannot be read; the design was not resumed\./);
    writeFileSync(state, readFileSync(state, "utf8").replace('"formatVersion": 4', '"formatVersion": 3'));
    const dated = await again();
    assert.match(messages(dated.outcome), /The design state \.oqas\/designs\/design-20261113T100000Z\.json cannot be read; the design was not resumed\./);
    assert.equal(edited.server.requests.length + dated.server.requests.length, 0);
  });

  it("refuses a plan with every scenario closed, and a changed working tree", async () => {
    const done = await design(replies(valid(3)));
    const closed = await design([], { root: done.root, plan: false, resume: { state: STATE, branch: BRANCH } });
    assert.match(messages(closed.outcome), /Every scenario of the plan of .* is closed; there is nothing to resume\./);
    const first = await stopped();
    writeFileSync(join(first.root, "specs", "orders.md"), "changed\n");
    const dirty = await design([], { root: first.root, plan: false, resume: { state: STATE, branch: BRANCH } });
    assert.match(messages(dirty.outcome), /Tracked files are changed: specs\/orders\.md\.\nThe design was not resumed\./);
    assert.equal(dirty.server.requests.length, 0);
  });
});

describe("the levels of the pyramid of tests a plan is asked for", () => {
  it("are those the caller names, or smoke, functional and business, told to the agent that plans", async () => {
    const { outcome, server } = await design(replies(valid(3)), { levels: ["functional", "cross-application"] });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.match(JSON.stringify(server.requests[0]!.body), /Levels of the pyramid of tests asked: functional, cross-application\./);
    const usual = await design(replies(valid(3)), { levels: "default" });
    assert.match(JSON.stringify(usual.server.requests[0]!.body), /Levels of the pyramid of tests asked: smoke, functional, business\./);
  });
});

describe("the count of the harness — each scenario of a plan is accounted for", () => {
  const givenUp = (id: string): Call => ({ id, name: "propose_test", arguments: { unfeasible: { reason: "The shop offers no way to follow an order." } } });

  it("succeeds with a scenario the agent that writes gave up with its reason, says so, and counts no test for it", async () => {
    const turns = [...valid(2), [run(broken("follow-order"), "r-follow-order")], [givenUp("g1")], [givenUp("g2")], DONE];
    const { outcome } = await design(replies(turns));
    assert.equal(outcome.ok, true, messages(outcome));
    assert.deepEqual(
      outcome.tests.map((test) => [test.scenario, test.classes.at(-1)!.class]),
      [
        ["list-orders", "passed"],
        ["place-order", "passed"],
        ["follow-order", "unfeasible"],
      ],
    );
    assert.match(
      messages(outcome),
      /Scenarios of the plan without a test, the agent that writes having said why \(1 of 3\): follow-order \(The shop offers no way to follow an order\.\)/,
    );
  });

  it("fails when a scenario has neither a test that counts nor a reason, and says how many are expected", async () => {
    const { outcome } = await design(replies([...valid(1), [run(broken("place-order"), "r-place-order")], [givenUp("g1")], [givenUp("g2")], DONE]));
    assert.equal(outcome.ok, false);
    assert.match(messages(outcome), /The design failed: 1 test was obtained, 2 are expected, one per scenario of the plan\./);
  });
});

describe("the review of each test for coherence with its scenario", () => {
  it("is done by an agent of its own, in a session of its own, once the test passed, and kept with the test", async () => {
    const report = (id: string, findings: unknown[]): Call => ({ id, name: "report_findings", arguments: { findings } });
    // The review of a test runs while its scenario is closed: its turns come before the next of the agent that writes.
    const reviewed = (name: string, findings: unknown[] = []) => [
      [run(spec(name), `r-${name}`)],
      [close(`c-${name}`)],
      [report(`f-${name}`, findings)],
      DONE,
      DONE,
    ];
    const fault = [{ where: "step 1", what: "No assertion verifies the orders." }];
    const turns = [
      ...reviewed("list-orders"),
      // The second test is found at fault: the agent that wrote it is told once, and keeps it as it is.
      ...reviewed("place-order", fault).slice(0, 4),
      [close("c2-place-order")],
      DONE,
      ...reviewed("follow-order"),
    ];
    const { outcome, server } = await design(replies(turns), { reviewTests: true });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.deepEqual(
      outcome.tests.map((test) => [test.scenario, test.classes.at(-1)!.class, test.review?.findings]),
      [
        ["list-orders", "passed", []],
        ["place-order", "passed", fault],
        ["follow-order", "passed", []],
      ],
    );
    assert.match(told(server, "c-place-order"), /^Warning \(TEST-COHERENCE\): another agent read the test of scenario place-order against its sheet/);
    assert.deepEqual(stateOf(outcome).tests[1]!.review!.findings, fault);
  });
});

describe("the review of the code of each test for its quality", () => {
  it("is done by an agent of its own, with the instructions of the caller, after the review of coherence, and kept with the test", async () => {
    const report = (id: string, name: string, findings: unknown[]): Call => ({ id, name, arguments: { findings } });
    const dated = [{ where: "step 1", what: "The count asserted changes with the data.", concerns: "plan" }];
    // Each review runs in a session of its own while the scenario is closed: coherence first, then the code.
    const reviewed = (name: string, findings: unknown[] = []) => [
      [run(spec(name), `r-${name}`)],
      [close(`c-${name}`)],
      [report(`f-${name}`, "report_findings", [])],
      DONE,
      [report(`q-${name}`, "report_quality", findings)],
      DONE,
      DONE,
    ];
    const { outcome, server } = await design(replies([...reviewed("list-orders", dated), ...reviewed("place-order"), ...reviewed("follow-order")]), {
      reviewTests: true,
      reviewCode: true,
      reviewerInstructions: "Review the code against the charter.",
    });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.deepEqual(
      outcome.tests.map((test) => [test.scenario, test.review?.findings, test.quality?.findings]),
      [
        ["list-orders", [], dated],
        ["place-order", [], []],
        ["follow-order", [], []],
      ],
    );
    assert.ok(JSON.stringify(server.requests.map((request) => request.body)).includes("Review the code against the charter."));
    // Without the instructions of a reviewer, or when the review of the code is not asked, no code is reviewed.
    for (const setup of [{ reviewCode: true }, { reviewerInstructions: "Review the code against the charter." }]) {
      const plain = await design(replies(valid(3)), setup);
      assert.deepEqual(
        plain.outcome.tests.map((test) => test.quality),
        [undefined, undefined, undefined],
      );
    }
  });
});
