import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  journaledRun,
  runIdAt,
  runInboxFile,
  runJournalFile,
  RUNS_FOLDER,
  runStamp,
  runStartedAt,
  runStateFile,
  traceFile,
  TRACES_FOLDER,
  traceStamp,
} from "../src/index.ts";

const STARTED = new Date("2026-11-13T12:00:00.000Z");
const RUN = "oqas-2026-11-13T12-00-00-000Z";

describe("the state folder of a test repository", () => {
  it("keeps the runs and the traces in two folders", () => {
    assert.deepEqual([RUNS_FOLDER, TRACES_FOLDER], ["runs", "traces"]);
  });
});

describe("a run", () => {
  it("is named after the date it started, which its identifier gives back", () => {
    assert.equal(runIdAt(STARTED), RUN);
    assert.equal(runStamp(RUN), "2026-11-13T12-00-00-000Z");
    assert.equal(runStartedAt(RUN), "2026-11-13T12:00:00.000Z");
  });

  it("names its journal and its state after itself", () => {
    assert.deepEqual([runJournalFile(RUN), runStateFile(RUN)], [`${RUN}.jsonl`, `${RUN}.json`]);
  });
});

describe("the inbox of a run", () => {
  it("is named after the run, beside its journal", () => {
    assert.equal(runInboxFile(RUN), "oqas-2026-11-13T12-00-00-000Z.inbox.jsonl");
  });
});

describe("a file of the folder of the runs", () => {
  it("is the journal of the run it names, and of none when it is its state, its inbox or anything else", () => {
    assert.equal(journaledRun(runJournalFile(RUN)), RUN);
    for (const name of [
      runStateFile(RUN),
      runInboxFile(RUN),
      "run-2026-11-13T12-00-00-000Z",
      "oqas-2026-11-13.jsonl",
      `${RUN}.jsonl.bak`,
      `x${RUN}.jsonl`,
      "notes.txt",
    ]) {
      assert.equal(journaledRun(name), undefined, name);
    }
  });
});

describe("a trace", () => {
  it("is named after what it traces and the date it started, written as in the identifier of a run", () => {
    assert.equal(traceFile("cartography-local", STARTED), "cartography-local-2026-11-13T12-00-00-000Z.jsonl");
    assert.equal(traceStamp(traceFile("cartography-local", STARTED)), runStamp(RUN));
  });

  it("is no file that does not end on such a date", () => {
    for (const name of ["design-local.jsonl", "design-local-2026-11-13.jsonl", "design-local-2026-11-13T12-00-00-000Z.json", "notes.txt"]) {
      assert.equal(traceStamp(name), undefined, name);
    }
  });
});
