import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { at, delivered, entry, sent, traced } from "../src/index.ts";

describe("the lines of a run written for a test", () => {
  it("are dated in seconds after 09:00 on the day of the first run", () => {
    assert.deepEqual([at(0), at(61)], ["2026-11-14T09:00:00.000Z", "2026-11-14T09:01:01.000Z"]);
  });

  it("are a line of a trace, with its source when it has one, an entry of the journal and a line of the inbox, each with its end", () => {
    assert.equal(
      traced(1, "card", "harness", { type: "started" }, "orders-db"),
      `{"at":"${at(1)}","phase":"card","source":"orders-db","actor":"harness","event":{"type":"started"}}\n`,
    );
    assert.equal(traced(2, "plan", "agent", { type: "end" }), `{"at":"${at(2)}","phase":"plan","actor":"agent","event":{"type":"end"}}\n`);
    assert.equal(entry(3, "summary", "info", "Done."), `{"at":"${at(3)}","step":"summary","event":"info","message":"Done."}\n`);
    assert.equal(sent(4, "not that page"), `{"at":"${at(4)}","text":"not that page"}\n`);
  });

  it("are the line the harness traces when it delivers a message of the person", () => {
    assert.equal(delivered(5, "plan", 2, "not that page"), traced(5, "plan", "harness", { type: "person", message: 2, text: "not that page" }));
    assert.equal(delivered(5, "plan", 2), traced(5, "plan", "harness", { type: "person", message: 2, text: "said" }));
  });
});
