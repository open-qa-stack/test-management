import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { runIdAt, RUNS_FOLDER, traceFile, TRACES_FOLDER } from "../src/index.ts";

const STARTED = new Date("2026-11-13T12:00:00.000Z");

describe("the state folder of a test repository", () => {
  it("keeps the runs of the tests and the traces in two folders", () => {
    assert.deepEqual([RUNS_FOLDER, TRACES_FOLDER], ["runs", "traces"]);
  });
});

describe("a run", () => {
  it("is named after the date it started", () => {
    assert.equal(runIdAt(STARTED), "oqas-2026-11-13T12-00-00-000Z");
  });
});

describe("a trace", () => {
  it("is named after what it traces and the date it started, written as in the identifier of a run", () => {
    assert.equal(traceFile("cartography-local", STARTED), "cartography-local-2026-11-13T12-00-00-000Z.jsonl");
  });
});
