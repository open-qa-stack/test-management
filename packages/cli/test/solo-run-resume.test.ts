import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { chain, FIRST_RUN, later, solo, stateOf } from "./solo-run-support.ts";

describe("autonomy, criterion 5 — --resume of a run no limit stopped stops with 3, and says so", () => {
  it("names the run that was not stopped by a limit, and the one whose state cannot be read", async () => {
    const done = await solo(chain(), { environment: "local", now: later(12) });
    assert.equal(done.code, 0, done.err);
    const again = await solo([], { root: () => done.root, resume: FIRST_RUN });
    assert.equal(again.code, 3);
    assert.match(again.err, new RegExp(`The run ${FIRST_RUN} was not stopped by a limit; only a run a limit stopped can be resumed\\.`));
    assert.equal(again.server.requests.length, 0);
    const unknown = await solo([], { root: () => done.root, resume: "oqas-2020-01-01T00-00-00-000Z" });
    assert.equal(unknown.code, 3);
    assert.match(unknown.err, /The run oqas-2020-01-01T00-00-00-000Z cannot be resumed: its state .* cannot be read\./);
  });

  it("refuses a state whose content is not that of a run, and a run stopped in its design without an index", async () => {
    const done = await solo(chain(), { environment: "local", now: later(12) });
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
      const again = await solo([], { root: () => done.root, resume: runId });
      assert.equal(again.code, 3, runId);
      assert.match(again.err, new RegExp(`The run ${runId} cannot be resumed: its state .* cannot be read\\.`));
      assert.equal(again.server.requests.length, 0);
    }
  });

  it("resumes a run once, and names the run that resumed it", async () => {
    const done = await solo(chain(), { environment: "local", now: later(12) });
    const runs = join(done.root, ".oqas", "runs");
    const stopped = { ...stateOf(done.root), stoppedBy: { step: "design", limit: "iterations" } };
    const resumer = "oqas-2026-11-13T13-00-00-000Z";
    writeFileSync(join(runs, `${FIRST_RUN}.json`), JSON.stringify(stopped));
    writeFileSync(join(runs, `${resumer}.json`), JSON.stringify({ ...stopped, runId: resumer, resumes: FIRST_RUN, stoppedBy: undefined }));
    const twice = await solo([], { root: () => done.root, resume: FIRST_RUN });
    assert.equal(twice.code, 3);
    assert.match(twice.err, new RegExp(`The run ${FIRST_RUN} was resumed already, by the run ${resumer}; resume that one instead, if a limit stopped it\\.`));
    assert.equal(twice.server.requests.length, 0);
  });
});
