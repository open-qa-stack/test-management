import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { scriptedServer, toolCalls } from "@open-qa-stack/testing";
import { MODEL, git, submit, IDS, scenario, ended, read, written, chain, ran, stateOf, boundedTo } from "./run-support.ts";

/** What the summary of a run says of the design a limit stopped. */
const DESIGN_STOPPED = /\[summary\] The design was stopped by its iterations limit: what it produced is kept in the test repository\./;

describe("a run whose design a limit of the autonomy stopped", () => {
  it("exits with 5 after a plan and a kept test, says so in its summary, and keeps that test on its branch", async () => {
    // The check of the server, the cartography, the plan, test-1, then the session of test-2 cut at its fifth call, its test run but not closed.
    const cut = [written("test-2")[0]!, read("l1"), read("l2"), read("l3"), read("l4")];
    const server = await scriptedServer([...chain().slice(0, 12), ...cut]);
    try {
      const run = await ran([], { environment: "local", modelUrl: server.baseUrl, config: boundedTo(5) });
      assert.equal(run.code, 5, run.err);
      assert.equal(server.requests.length, 1 + 5 + 3 + 3 + 5);
      assert.match(run.err, /The task reached its iterations limit; no test was written for the scenario under way\./);
      assert.match(run.err, DESIGN_STOPPED);
      const stopped = stateOf(run.root);
      assert.deepEqual(stopped.stoppedBy, { step: "design", limit: "iterations" });
      assert.deepEqual(stopped.designed, ["apps/shop/tests/orders/listing/test-1.spec.ts"]);
      assert.equal(
        git(run.root, "ls-tree", "-r", "--name-only", stopped.branch!, "apps"),
        "apps/shared/fixtures.ts\napps/shop/tests/orders/listing/test-1.spec.ts",
      );
    } finally {
      await server.close();
    }
  });

  it("runs none of the tests it kept when a scenario of its plan is left without one", async () => {
    const four = [...IDS, "test-4"];
    // The check of the server, the cartography, a plan of four scenarios, three tests, then the session of the fourth cut at its fourth call.
    const server = await scriptedServer([
      ...chain().slice(0, 7),
      { body: toolCalls(MODEL, [submit("propose_plan", { scenarios: four.map(scenario) }, "plan")]) },
      ended,
      ...IDS.flatMap(written),
      read("l1"),
      read("l2"),
      read("l3"),
      read("l4"),
    ]);
    try {
      const run = await ran([], { environment: "local", modelUrl: server.baseUrl, config: boundedTo(4) });
      assert.equal(run.code, 5, run.err);
      const stopped = stateOf(run.root);
      assert.deepEqual([stopped.stoppedBy, stopped.designed.length, stopped.tests.length], [{ step: "design", limit: "iterations" }, 3, 0]);
      assert.match(run.err, DESIGN_STOPPED);
      assert.equal(run.runner.finalRuns, 0);
    } finally {
      await server.close();
    }
  });
});

describe("a run whose cartography a limit of the autonomy stopped", () => {
  it("exits with 5 without a knowledge base, and says in its state which step was stopped", async () => {
    const bad = { body: toolCalls(MODEL, [submit("submit_knowledge_base", { domains: [] }, "x0")]) };
    // The session that maps the document is cut at its second call, once its domain is handed in: its last answer is never asked.
    const server = await scriptedServer([...chain().slice(0, 3), bad, bad]);
    try {
      const run = await ran([], { environment: "local", modelUrl: server.baseUrl, config: boundedTo(2) });
      assert.equal(run.code, 5, run.err);
      const stopped = stateOf(run.root);
      assert.deepEqual([stopped.stoppedBy, stopped.knowledgeBase, stopped.designed], [{ step: "cartography", limit: "iterations" }, undefined, []]);
      assert.match(run.err, /\[summary\] The cartography was stopped by its iterations limit: what it produced is kept in the test repository\./);
    } finally {
      await server.close();
    }
  });
});
