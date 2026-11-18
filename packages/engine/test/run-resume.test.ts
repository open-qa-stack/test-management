import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { scriptedServer, toolCalls } from "@open-qa-stack/testing";
import {
  MODEL,
  git,
  submit,
  IDS,
  scenario,
  ended,
  read,
  written,
  chain,
  ran,
  stateOf,
  FIRST_RUN,
  hostOf,
  repository,
  later,
  boundedTo,
  offered,
  tried,
} from "./run-support.ts";

describe("autonomy, criterion 4 — a design stopped by maxIterations after a plan and a kept test is resumed with --resume", () => {
  it("gives the resumed sessions the sheets of the scenarios left, plans nothing, and ends the branch with the tests of both", async () => {
    const replies = chain();
    // The first run: the check of the server, the cartography, the plan, test-1, then the session of test-2 cut at its fifth call, its test run but not closed.
    const cut = [written("test-2")[0]!, read("l1"), read("l2"), read("l3"), read("l4")];
    const server = await scriptedServer([...replies.slice(0, 12), ...cut, { body: { data: [] } }, ...written("test-2"), ...written("test-3")]);
    try {
      const first = await ran([], { environment: "local", modelUrl: server.baseUrl, config: boundedTo(5) });
      assert.equal(first.code, 5, first.err);
      assert.equal(server.requests.length, 1 + 5 + 3 + 3 + 5);
      assert.match(first.err, /The task reached its iterations limit; no test was written for the scenario under way\./);
      assert.match(first.out, new RegExp(`The design was stopped by its iterations limit: what it produced is kept in the test repository\\.\n`));
      const stopped = stateOf(first.root);
      assert.deepEqual(stopped.stoppedBy, { step: "design", limit: "iterations" });
      assert.deepEqual(stopped.designed, ["apps/shop/tests/orders/listing/test-1.spec.ts"]);
      const branch = stopped.branch!;
      const base = git(first.root, "rev-parse", `${branch}~1`);

      const resumed = await ran([], { root: () => first.root, modelUrl: server.baseUrl, config: boundedTo(5), resume: FIRST_RUN, now: later(13) });
      assert.equal(resumed.code, 0, resumed.err);
      // The first session of the run resumed is that of the first scenario not closed: it is given its sheet, not the test kept.
      const session = server.requests[18]!.body;
      assert.ok(JSON.stringify(session).includes("Scenario 2 of 3: test-2"), "the session is given the sheet of the scenario left");
      assert.ok(!JSON.stringify(session).includes("test-1"), "the session is not given the kept test");
      assert.ok(!offered(session).includes("propose_plan"));
      assert.ok(!server.requests.slice(18).some((request) => JSON.stringify(request.body).includes('"name":"propose_plan"')));
      // The resumed design tries the tests of the scenarios left, never the kept one.
      assert.deepEqual(tried(resumed.runner), ["apps/shop/tests/orders/listing/test-2.spec.ts", "apps/shop/tests/orders/listing/test-3.spec.ts"]);
      const state = stateOf(first.root, "oqas-2026-11-13T13-00-00-000Z");
      assert.deepEqual([state.resumes, state.branch, state.stoppedBy], [FIRST_RUN, branch, undefined]);
      assert.deepEqual(state.designed, [
        "apps/shop/tests/orders/listing/test-1.spec.ts",
        "apps/shop/tests/orders/listing/test-2.spec.ts",
        "apps/shop/tests/orders/listing/test-3.spec.ts",
      ]);
      assert.deepEqual(
        state.steps.map((step) => step.step),
        ["configuration", "prerequisites", "design", "execution"],
      );
      assert.deepEqual(git(first.root, "ls-tree", "-r", "--name-only", branch, "apps").split("\n"), [
        "apps/shared/fixtures.ts",
        "apps/shop/tests/orders/listing/test-1.spec.ts",
        "apps/shop/tests/orders/listing/test-2.spec.ts",
        "apps/shop/tests/orders/listing/test-3.spec.ts",
      ]);
      assert.equal(git(first.root, "rev-parse", `${branch}~2`), base, "one commit for each run, on the same branch");
    } finally {
      await server.close();
    }
  });

  it("keeps the cards a cartography made, then the plan of a design stopped before its first test", async () => {
    const bad = { body: toolCalls(MODEL, [submit("submit_index", { domains: [] }, "x0")]) };
    const server = await scriptedServer([
      // The session that maps the document is cut at its second call, once its domain is handed in: its last answer is never asked.
      ...chain().slice(0, 3),
      bad,
      bad,
      { body: { data: [] } },
      // The index, the plan, at the second and last call of its session, then the session of test-1, cut before it ran anything.
      ...chain().slice(4, 8),
      read("l1"),
      read("l2"),
      { body: { data: [] } },
      // The session of test-1, closed at its last call, then that of test-2, cut.
      ...written("test-1").slice(0, 2),
      read("l3"),
      read("l4"),
    ]);
    try {
      const first = await ran([], { environment: "local", modelUrl: server.baseUrl, config: boundedTo(2) });
      assert.equal(first.code, 5, first.err);
      assert.deepEqual(stateOf(first.root).stoppedBy, { step: "cartography", limit: "iterations" });
      const again = await ran([], { root: () => first.root, modelUrl: server.baseUrl, config: boundedTo(2), resume: FIRST_RUN, now: later(13) });
      assert.equal(again.code, 5, again.err);
      assert.match(again.err, /The card of order-specs is up to date; it was kept\./);
      const second = stateOf(first.root, "oqas-2026-11-13T13-00-00-000Z");
      assert.deepEqual([second.stoppedBy, second.branch, second.designed], [{ step: "design", limit: "iterations" }, undefined, []]);
      assert.ok(second.designState !== undefined);
      const third = await ran([], {
        root: () => first.root,
        modelUrl: server.baseUrl,
        config: boundedTo(2),
        resume: "oqas-2026-11-13T13-00-00-000Z",
        now: later(14),
      });
      assert.equal(third.code, 5, third.err);
      const last = stateOf(first.root, "oqas-2026-11-13T14-00-00-000Z");
      assert.deepEqual([last.designed, last.designState], [["apps/shop/tests/orders/listing/test-1.spec.ts"], second.designState]);
      assert.equal(
        git(first.root, "ls-tree", "-r", "--name-only", last.branch!, "apps"),
        "apps/shared/fixtures.ts\napps/shop/tests/orders/listing/test-1.spec.ts",
      );
    } finally {
      await server.close();
    }
  });

  it("offers to resume a design a limit cut short after some of its tests, which run once every scenario has its own", async () => {
    const four = [...IDS, "test-4"];
    // The first run: the check of the server, the cartography, a plan of four scenarios, three tests, then the session of the fourth cut at its fourth call.
    const server = await scriptedServer([
      ...chain().slice(0, 7),
      { body: toolCalls(MODEL, [submit("propose_plan", { scenarios: four.map(scenario) }, "plan")]) },
      ended,
      ...IDS.flatMap(written),
      read("l1"),
      read("l2"),
      read("l3"),
      read("l4"),
      { body: { data: [] } },
      ...written("test-4"),
    ]);
    try {
      const first = await ran([], { environment: "local", modelUrl: server.baseUrl, config: boundedTo(4) });
      assert.equal(first.code, 5, first.err);
      const stopped = stateOf(first.root);
      // Three tests are kept on the branch, and none runs yet: the plan has a fourth scenario.
      assert.deepEqual([stopped.stoppedBy, stopped.designed.length, stopped.tests.length], [{ step: "design", limit: "iterations" }, 3, 0]);
      assert.match(first.out, new RegExp(`The design was stopped by its iterations limit: what it produced is kept in the test repository\\.\n`));
      const resumed = await ran([], { root: () => first.root, modelUrl: server.baseUrl, config: boundedTo(4), resume: FIRST_RUN, now: later(13) });
      assert.equal(resumed.code, 0, resumed.err);
      assert.deepEqual(tried(resumed.runner), ["apps/shop/tests/orders/listing/test-4.spec.ts"]);
      const state = stateOf(first.root, "oqas-2026-11-13T13-00-00-000Z");
      assert.deepEqual([state.stoppedBy, state.designed.length, state.tests.length], [undefined, 4, 4]);
    } finally {
      await server.close();
    }
  });
});

describe("a run that cannot be resumed", () => {
  /** What a store keeps of a run its iterations limit stopped in its design. */
  const stopped = (runId: string) => ({
    formatVersion: 1,
    runId,
    environment: "local",
    index: ".oqas/index/domain-index.json",
    stoppedBy: { step: "design", limit: "iterations" },
  });

  /** Resumes a run of a test repository whose store keeps what is given, and gives the exit code and the journal. */
  async function resumed(runId: string, kept: Readonly<Record<string, unknown>>) {
    const run = await ran([], {
      resume: runId,
      root: (config) => {
        const root = repository(config);
        for (const [id, state] of Object.entries(kept)) hostOf(root).store.states.set(id, state);
        return root;
      },
    });
    assert.equal(run.server.requests.length, 0);
    return [run.code, run.err] as const;
  }

  it("stops with 3 on a state its store does not hold, or that is not that of the run", async () => {
    const { index: _index, ...withoutIndex } = stopped(FIRST_RUN);
    for (const state of [
      undefined,
      null,
      { ...stopped(FIRST_RUN), runId: "oqas-another" },
      { ...stopped(FIRST_RUN), brief: 1 },
      { ...stopped(FIRST_RUN), stoppedBy: "iterations" },
      { ...stopped(FIRST_RUN), stoppedBy: { step: "design" } },
      { ...stopped(FIRST_RUN), stoppedBy: { step: "execution", limit: "iterations" } },
      withoutIndex,
    ]) {
      const [code, err] = await resumed(FIRST_RUN, { [FIRST_RUN]: state });
      assert.equal(code, 3, JSON.stringify(state));
      assert.match(err, new RegExp(`\\[configuration\\] error: The run ${FIRST_RUN} cannot be resumed: its state memory:${FIRST_RUN} cannot be read\\.`));
    }
  });

  it("stops with 3 on a run no limit stopped, and on one another run resumed already", async () => {
    const { stoppedBy: _stoppedBy, ...complete } = stopped(FIRST_RUN);
    const [code, err] = await resumed(FIRST_RUN, { [FIRST_RUN]: complete });
    assert.equal(code, 3);
    assert.match(err, new RegExp(`The run ${FIRST_RUN} was not stopped by a limit; only a run a limit stopped can be resumed\\.`));
    const resumer = "oqas-2026-11-13T13-00-00-000Z";
    const twice = await resumed(FIRST_RUN, {
      // What is no state, and the state of a run that resumes another, are passed over.
      unreadable: undefined,
      "oqas-other": { ...stopped("oqas-other"), resumes: "oqas-before" },
      [FIRST_RUN]: { ...stopped(FIRST_RUN), stoppedBy: { step: "cartography", limit: "duration" } },
      [resumer]: { ...complete, runId: resumer, resumes: FIRST_RUN },
    });
    assert.equal(twice[0], 3);
    assert.match(twice[1], new RegExp(`The run ${FIRST_RUN} was resumed already, by the run ${resumer}; resume that one instead, if a limit stopped it\\.`));
  });
});
