import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
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
  solo,
  stateOf,
  FIRST_RUN,
  later,
  boundedTo,
  offered,
  tried,
} from "./solo-run-support.ts";

describe("autonomy, criterion 4 — a design stopped by maxIterations after a plan and a kept test is resumed with --resume", () => {
  it("gives the resumed sessions the sheets of the scenarios left, plans nothing, and ends the branch with the tests of both", async () => {
    const replies = chain();
    // The first run: the check of the server, the cartography, the plan, test-1, then the session of test-2 cut at its fifth call, its test run but not closed.
    const cut = [written("test-2")[0]!, read("l1"), read("l2"), read("l3"), read("l4")];
    const server = await scriptedServer([...replies.slice(0, 12), ...cut, { body: { data: [] } }, ...written("test-2"), ...written("test-3")]);
    try {
      const first = await solo([], { environment: "local", modelUrl: server.baseUrl, config: boundedTo(5) });
      assert.equal(first.code, 5, first.err);
      assert.equal(server.requests.length, 1 + 5 + 3 + 3 + 5);
      assert.match(first.err, /The task reached its iterations limit; no test was written for the scenario under way\./);
      assert.match(first.out, new RegExp(`The design was stopped by its iterations limit; resume the run with: oqas --resume ${FIRST_RUN}\n`));
      const stopped = stateOf(first.root);
      assert.deepEqual(stopped.stoppedBy, { step: "design", limit: "iterations" });
      assert.deepEqual(stopped.designed, ["apps/shop/tests/orders/listing/test-1.spec.ts"]);
      const branch = stopped.branch!;
      const base = git(first.root, "rev-parse", `${branch}~1`);

      const resumed = await solo([], { root: () => first.root, modelUrl: server.baseUrl, config: boundedTo(5), resume: FIRST_RUN, now: later(13) });
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
      const first = await solo([], { environment: "local", modelUrl: server.baseUrl, config: boundedTo(2) });
      assert.equal(first.code, 5, first.err);
      assert.deepEqual(stateOf(first.root).stoppedBy, { step: "cartography", limit: "iterations" });
      const again = await solo([], { root: () => first.root, modelUrl: server.baseUrl, config: boundedTo(2), resume: FIRST_RUN, now: later(13) });
      assert.equal(again.code, 5, again.err);
      assert.match(again.err, /The card of order-specs is up to date; it was kept\./);
      const second = stateOf(first.root, "oqas-2026-11-13T13-00-00-000Z");
      assert.deepEqual([second.stoppedBy, second.branch, second.designed], [{ step: "design", limit: "iterations" }, undefined, []]);
      assert.ok(second.designState !== undefined);
      const third = await solo([], {
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
      const first = await solo([], { environment: "local", modelUrl: server.baseUrl, config: boundedTo(4) });
      assert.equal(first.code, 5, first.err);
      const stopped = stateOf(first.root);
      // Three tests are kept on the branch, and none runs yet: the plan has a fourth scenario.
      assert.deepEqual([stopped.stoppedBy, stopped.designed.length, stopped.tests.length], [{ step: "design", limit: "iterations" }, 3, 0]);
      assert.match(first.out, new RegExp(`The design was stopped by its iterations limit; resume the run with: oqas --resume ${FIRST_RUN}\n`));
      const resumed = await solo([], { root: () => first.root, modelUrl: server.baseUrl, config: boundedTo(4), resume: FIRST_RUN, now: later(13) });
      assert.equal(resumed.code, 0, resumed.err);
      assert.deepEqual(tried(resumed.runner), ["apps/shop/tests/orders/listing/test-4.spec.ts"]);
      const state = stateOf(first.root, "oqas-2026-11-13T13-00-00-000Z");
      assert.deepEqual([state.stoppedBy, state.designed.length, state.tests.length], [undefined, 4, 4]);
    } finally {
      await server.close();
    }
  });
});

describe("autonomy, criterion 5 — --resume of a run no limit stopped stops with 3, and says so", () => {
  it("names the run that was not stopped by a limit, and the one whose state cannot be read", async () => {
    const done = await solo(chain(), { environment: "local" });
    assert.equal(done.code, 0, done.err);
    const again = await solo([], { root: () => done.root, command: true, resume: FIRST_RUN });
    assert.equal(again.code, 3);
    assert.match(again.err, new RegExp(`The run ${FIRST_RUN} was not stopped by a limit; only a run a limit stopped can be resumed\\.`));
    assert.equal(again.server.requests.length, 0);
    const unknown = await solo([], { root: () => done.root, command: true, resume: "oqas-2020-01-01T00-00-00-000Z" });
    assert.equal(unknown.code, 3);
    assert.match(unknown.err, /The run oqas-2020-01-01T00-00-00-000Z cannot be resumed: its state .* cannot be read\./);
  });

  it("refuses a state whose content is not that of a run, and a run stopped in its design without an index", async () => {
    const done = await solo(chain(), { environment: "local" });
    const runs = join(done.root, ".oqas", "runs");
    const { index: _index, ...complete } = stateOf(done.root);
    for (const [runId, content] of [
      ["oqas-2026-11-13T15-00-00-000Z", "null"],
      ["oqas-2026-11-13T16-00-00-000Z", "{"],
      [
        "oqas-2026-11-13T17-00-00-000Z",
        JSON.stringify({ ...complete, runId: "oqas-2026-11-13T17-00-00-000Z", stoppedBy: { step: "design", limit: "iterations" } }),
      ],
      ["oqas-2026-11-13T18-00-00-000Z", JSON.stringify({ ...complete, stoppedBy: { step: "design", limit: "iterations" } })],
    ] as const) {
      writeFileSync(join(runs, `${runId}.json`), content);
      const again = await solo([], { root: () => done.root, command: true, resume: runId });
      assert.equal(again.code, 3, runId);
      assert.match(again.err, new RegExp(`The run ${runId} cannot be resumed: its state .* cannot be read\\.`));
      assert.equal(again.server.requests.length, 0);
    }
  });

  it("resumes a run once, and names the run that resumed it", async () => {
    const done = await solo(chain(), { environment: "local" });
    const runs = join(done.root, ".oqas", "runs");
    const stopped = { ...stateOf(done.root), stoppedBy: { step: "design", limit: "iterations" } };
    const resumer = "oqas-2026-11-13T13-00-00-000Z";
    writeFileSync(join(runs, `${FIRST_RUN}.json`), JSON.stringify(stopped));
    writeFileSync(join(runs, `${resumer}.json`), JSON.stringify({ ...stopped, runId: resumer, resumes: FIRST_RUN, stoppedBy: undefined }));
    const twice = await solo([], { root: () => done.root, command: true, resume: FIRST_RUN });
    assert.equal(twice.code, 3);
    assert.match(twice.err, new RegExp(`The run ${FIRST_RUN} was resumed already, by the run ${resumer}; resume that one instead, if a limit stopped it\\.`));
    assert.equal(twice.server.requests.length, 0);
  });
});
