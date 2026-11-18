import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { entryLine, type RunEntry } from "../src/index.ts";

const AT = "2026-11-13T12:00:00.000Z";

describe("an entry of the journal of a run, as a line a person reads", () => {
  it("gives the step, what the entry is unless it only informs, and the message", () => {
    const entries: RunEntry[] = [
      { at: AT, step: "configuration", event: "info", message: "Read." },
      { at: AT, step: "cartography", event: "started", message: "Mapping 2 sources." },
      { at: AT, step: "design", event: "error", message: "Nothing." },
    ];
    assert.deepEqual(entries.map(entryLine), ["[configuration] Read.", "[cartography] started: Mapping 2 sources.", "[design] error: Nothing."]);
  });

  it("ends with the figures of a step that finished: how long it took, to the tenth of a second, and its requests to the model", () => {
    const finished = { at: AT, step: "cartography", event: "finished", message: "Done." } as const;
    assert.deepEqual(
      [
        entryLine({ ...finished, durationMs: 1234, modelRequests: 5 }),
        entryLine({ ...finished, durationMs: 60_000 }),
        entryLine({ ...finished, modelRequests: 0 }),
      ],
      ["[cartography] finished: Done. (1.2 s, 5 model requests)", "[cartography] finished: Done. (60 s)", "[cartography] finished: Done. (0 model requests)"],
    );
  });
});
