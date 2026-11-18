import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { answer, closedPort } from "@open-qa-stack/testing";
import { MODEL, workspace, configText, chain, ran, stateOf, journalOf, untracked } from "./run-support.ts";

describe("solo command, criterion 1 — without a configuration, the command stops with 3 and touches nothing", () => {
  it("calls no model, runs nothing, and creates no file", async () => {
    const run = await ran([], { config: () => undefined });
    assert.equal(run.code, 3);
    assert.deepEqual([run.server.requests.length, run.runner.commands.length, untracked(run.root)], [0, 0, ""]);
    assert.match(run.err, /oqas\.json cannot be read/);
  });
});

describe("solo command, criterion 2 — an invalid configuration, or an environment not declared, stops with 3", () => {
  it("names the JSON path at fault, and writes nothing", async () => {
    const run = await ran([], { config: (url) => JSON.parse(JSON.stringify(configText(url))).replace('"autonomous"', '"reckless"') });
    assert.equal(run.code, 3);
    assert.match(run.err, /\/autonomy\/level/);
    assert.deepEqual([run.server.requests.length, untracked(run.root)], [0, ""]);
  });

  it("names the environment at fault, and asks for one when several are declared", async () => {
    const unknown = await ran([], { environment: "production" });
    assert.equal(unknown.code, 3);
    assert.match(unknown.err, /The environment production is not declared; the configuration declares local, staging\./);
    const unnamed = await ran([], { config: (url) => configText(url) });
    assert.equal(unnamed.code, 3);
    assert.match(unnamed.err, /Several environments are declared \(local, staging\); name one with --environment\./);
  });
});

describe("solo command, criterion 3 — a missing prerequisite stops with 4, and nothing is mapped", () => {
  it("names the folder that is no git repository, the model server that does not answer, and npm", async () => {
    const down = `http://127.0.0.1:${await closedPort()}/v1`;
    const run = await ran([], {
      environment: "local",
      modelUrl: down,
      script: { npm: 127 },
      root: (config) => {
        const root = mkdtempSync(join(workspace, "plain-"));
        writeFileSync(join(root, "oqas.json"), config!);
        return root;
      },
    });
    assert.equal(run.code, 4);
    assert.match(run.err, /is not the root of a git repository with a commit/);
    assert.match(run.err, new RegExp(`The model server at ${down.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} does not answer`));
    assert.match(run.err, /npm cannot be run/);
    assert.ok(!run.err.includes("[cartography]"));
  });
});

describe("solo command, criterion 4 — the whole chain, every test passed, exits with 0", () => {
  it("runs the six steps in order, each with its start and its end", async () => {
    const run = await ran(chain(), { environment: "local" });
    assert.equal(run.code, 0, run.err);
    const framing = journalOf(run.root)
      .filter((entry) => entry.event === "started" || entry.event === "finished")
      .map((entry) => `${entry.step}:${entry.event}`);
    assert.deepEqual(
      framing,
      ["configuration", "prerequisites", "cartography", "design", "execution", "summary"].flatMap((step) => [`${step}:started`, `${step}:finished`]),
    );
    assert.match(run.out, /^Run oqas-2026-11-13T12-00-00-000Z: exit code 0\./);
    // The default charter ends each step with a screenshot: the skeleton of each test holds it.
    assert.ok(JSON.stringify(run.server.requests.map((request) => request.body)).includes("await testInfo.attach("));
  });
});

describe("solo command, criterion 5 — a failed test exits with 1; a blocked or indeterminate one, without a failure, with 2", () => {
  it("exits with 1 when a test fails at the end, and with 2 when one is skipped", async () => {
    const failed = await ran(chain(), { environment: "local", script: { final: (file) => (file.endsWith("test-2.spec.ts") ? "unexpected" : "expected") } });
    assert.equal(failed.code, 1, failed.err);
    const skipped = await ran(chain(), { environment: "local", script: { final: (file) => (file.endsWith("test-2.spec.ts") ? "skipped" : "expected") } });
    assert.equal(skipped.code, 2, skipped.err);
  });
});

describe("solo command, criterion 6 — an application that does not answer when the tests run blocks them, and exits with 2", () => {
  it("gives blocked to every test in the state", async () => {
    const run = await ran(chain(), { environment: "local", script: { downAfterDesign: true } });
    assert.equal(run.code, 2, run.err);
    const state = stateOf(run.root);
    assert.equal(state.designed.length, 3);
    assert.deepEqual(
      state.tests.map((test) => test.verdict),
      ["blocked", "blocked", "blocked"],
    );
  });
});

describe("solo command, criteria 7 and 8 — a limit that stops a task is journaled; without a test designed, the command stops with 5 and runs nothing", () => {
  it("names the limit reached, writes no passed, and runs no test", async () => {
    const replies = [...chain().slice(0, 5), ...Array.from({ length: 3 }, () => ({ body: answer(MODEL, "I see nothing to test.") }))];
    const config = (url: string) =>
      configText(url, {
        autonomy: { level: "bounded", task: { maxIterations: 2 } },
      });
    const run = await ran(replies, { environment: "local", config });
    assert.equal(run.code, 5, run.err);
    assert.match(run.err, /reached its iterations limit/);
    assert.equal(run.runner.finalRuns, 0);
    assert.ok(stateOf(run.root).tests.every((test) => test.verdict !== "passed"));
  });
});

describe("solo command, criterion 9 — the state of a complete run", () => {
  it("holds the run, the index, the tests and their branch, the report, a verdict per test, and the duration and requests of each step", async () => {
    // A clock that moves a second at each reading, from the instant of the run: each step takes time.
    let tick = 0;
    const now = () => new Date(Date.parse("2026-11-13T12:00:00.000Z") + 1000 * tick++);
    const run = await ran(chain(), { environment: "local", now });
    const state = stateOf(run.root);
    assert.equal(state.runId, "oqas-2026-11-13T12-00-00-000Z");
    assert.equal(state.index, ".oqas/index/domain-index.json");
    assert.deepEqual([...state.designed].sort(), [
      "apps/shop/tests/orders/listing/test-1.spec.ts",
      "apps/shop/tests/orders/listing/test-2.spec.ts",
      "apps/shop/tests/orders/listing/test-3.spec.ts",
    ]);
    assert.match(state.branch!, /^oqas\/design-/);
    assert.match(state.report!, /^\.oqas\/runs\/run-.*\/report\.json$/);
    assert.ok(existsSync(join(run.root, state.run!)));
    assert.deepEqual(
      state.tests.map((test) => test.verdict),
      ["passed", "passed", "passed"],
    );
    // The state is written by the summary, which therefore is not among its steps.
    assert.deepEqual(
      state.steps.map((step) => step.step),
      ["configuration", "prerequisites", "cartography", "design", "execution"],
    );
    assert.ok(
      state.steps.find((step) => step.step === "cartography")!.modelRequests > 0 && state.steps.find((step) => step.step === "design")!.modelRequests > 0,
    );
    assert.ok(
      state.steps.every((step) => step.durationMs > 0),
      JSON.stringify(state.steps),
    );
    // Each step counts the requests of its own sessions: with the list of the models the prerequisites ask for, they are all the server received.
    assert.deepEqual(
      state.steps.map((step) => step.modelRequests),
      [0, 0, 5, 12, 0],
    );
    assert.equal(run.server.requests.length, 1 + 5 + 12);
    assert.ok(state.durationMs > state.steps.reduce((total, step) => total + step.durationMs, 0) - 1);
  });
});
