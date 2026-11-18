import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { toolCalls } from "@open-qa-stack/testing";
import { entryLine } from "@open-qa-stack/domain";
import { MODEL, IDS, FIRST_RUN, chain, journalOf, later, planned, scenario, solo, stateOf, submit, untracked } from "./solo-run-support.ts";

describe("what a run of the command leaves in the test repository and on its outputs", () => {
  it("keeps the journal and the state of the run in the state folder, prints the journal on the error output and the summary on the standard one", async () => {
    const uncovered = [{ asked: "Cancel an order.", reason: "No operation of the shop cancels one." }];
    const partial = submit("propose_plan", { scenarios: IDS.map(scenario), uncovered }, "plan");
    const replies = chain().map((reply) => (reply.body === planned.body ? { body: toolCalls(MODEL, [partial]) } : reply));
    const run = await solo(replies, { environment: "local", brief: "Test the orders.", now: later(12) });
    assert.equal(run.code, 0, run.err);
    const runs = join(run.root, ".oqas", "runs");
    // The journal and the state, named after the run; the inbox is a file only once someone writes to it.
    assert.deepEqual(
      readdirSync(runs).filter((name) => name.startsWith("oqas-")),
      [`${FIRST_RUN}.json`, `${FIRST_RUN}.jsonl`],
    );
    const state = stateOf(run.root);
    assert.equal(readFileSync(join(runs, `${FIRST_RUN}.json`), "utf8"), `${JSON.stringify(state, null, 2)}\n`);
    assert.deepEqual(Object.keys(state), [
      "formatVersion",
      "runId",
      "environment",
      "brief",
      "startedAt",
      "designed",
      "tests",
      "journal",
      "index",
      "uncovered",
      "branch",
      "designState",
      "run",
      "report",
      "exitCode",
      "steps",
      "durationMs",
    ]);
    const { formatVersion, runId, environment, brief, startedAt, journal, index, exitCode, steps, durationMs } = state;
    assert.deepEqual(
      { formatVersion, runId, environment, brief, startedAt, journal, index, uncovered: state.uncovered, exitCode, steps, durationMs },
      {
        formatVersion: 1,
        runId: FIRST_RUN,
        environment: "local",
        brief: "Test the orders.",
        startedAt: "2026-11-13T12:00:00.000Z",
        journal: `.oqas/runs/${FIRST_RUN}.jsonl`,
        index: ".oqas/index/domain-index.json",
        uncovered,
        exitCode: 0,
        // The clock of the test stands still: each step took no time.
        steps: [
          { step: "configuration", durationMs: 0, modelRequests: 0 },
          { step: "prerequisites", durationMs: 0, modelRequests: 0 },
          { step: "cartography", durationMs: 0, modelRequests: 5 },
          { step: "design", durationMs: 0, modelRequests: 12 },
          { step: "execution", durationMs: 0, modelRequests: 0 },
        ],
        durationMs: 0,
      },
    );
    // The error output holds the journal alone, each entry of the file as a line, from the configuration to the summary.
    const entries = journalOf(run.root);
    assert.equal(run.err, entries.map((entry) => `${entryLine(entry)}\n`).join(""));
    assert.deepEqual(
      [entries[0], entries.at(-1)],
      [
        { at: "2026-11-13T12:00:00.000Z", step: "configuration", event: "started", message: "The configuration starts." },
        { at: "2026-11-13T12:00:00.000Z", step: "summary", event: "finished", message: "The summary succeeded.", durationMs: 0, modelRequests: 0 },
      ],
    );
    assert.equal(
      run.out,
      [
        `Run ${FIRST_RUN}: exit code 0.`,
        `Tests written on the branch ${state.branch}.`,
        ...state.tests.map((test) => `passed        ${test.id}`),
        "Not covered: Cancel an order. No operation of the shop cancels one.",
        `State: .oqas/runs/${FIRST_RUN}.json`,
        "",
      ].join("\n"),
    );
    assert.equal(state.tests.length, 3);
    for (const kept of readdirSync(runs, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()))
      assert.ok(!readFileSync(join(kept.parentPath, kept.name), "utf8").includes("w1tness-pass"), kept.name);
  });

  it("writes no file when the configuration or a prerequisite stops it", async () => {
    const unconfigured = await solo([], { config: () => undefined });
    assert.equal(unconfigured.code, 3);
    assert.equal(untracked(unconfigured.root), "");
    const unready = await solo([], { environment: "local", script: { npm: 127 } });
    assert.equal(unready.code, 4);
    assert.match(unready.err, /\[prerequisites\] error: npm cannot be run; it installs the dependencies of the test repository\.\n/);
    assert.equal(untracked(unready.root), "");
  });
});
