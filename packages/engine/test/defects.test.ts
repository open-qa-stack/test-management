import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { UnknownDefectError, type ExecutionVerdict, type TestExecution } from "@open-qa-stack/domain";
import { Defects } from "../src/index.ts";
import { MemoryDefectStore } from "./support/memory-defect-store.ts";

const TEST = { path: "apps/shop/tests/orders/listing/list-orders.spec.ts", title: "The orders are listed" };

/** The executions of the file of the test, the latest first, each with the verdict of the test and when it ran. */
function ran(...runs: readonly (readonly [string, ExecutionVerdict, string?])[]): { ofFile: () => Promise<TestExecution[]> } {
  return {
    ofFile: () =>
      Promise.resolve(
        runs.map(
          ([ranAt, verdict, title = TEST.title], rank) =>
            ({ id: `e${rank}`, origin: "launch", ranAt, result: { ...TEST, title, verdict } }) as unknown as TestExecution,
        ),
      ),
  };
}

/** A clock that tells each hour of the day of the tests in turn, from ten. */
function hours(): () => Date {
  let hour = 10;
  return () => new Date(`2026-11-27T${String(hour++).padStart(2, "0")}:00:00.000Z`);
}

describe("the defects reported from tests that failed", () => {
  it("are kept open, the latest first, then fixed, closed or open again, each view counting its own", async () => {
    const defects = new Defects(new MemoryDefectStore(), ran(), hours());
    const first = await defects.report({ title: "The total is wrong", severity: "S2", description: "", test: TEST, execution: "e9" });
    assert.deepEqual(first, {
      id: "D-1",
      title: "The total is wrong",
      severity: "S2",
      description: "",
      test: TEST,
      execution: "e9",
      status: "open",
      openedAt: "2026-11-27T10:00:00.000Z",
      stage: "open",
    });
    await defects.report({ title: "No paging", severity: "S4", description: "", test: TEST });
    assert.deepEqual((await defects.list()).counts, { open: 2, toReplay: 0, closed: 0 });
    const fixed = await defects.change("D-1", "fixed");
    assert.deepEqual([fixed.status, fixed.fixedAt, fixed.stage], ["fixed", "2026-11-27T12:00:00.000Z", "to_replay"]);
    // Moved where it stands already, it stays as it is.
    assert.equal((await defects.change("D-1", "fixed")).fixedAt, "2026-11-27T12:00:00.000Z");
    const closed = await defects.change("D-1", "closed");
    assert.deepEqual([closed.fixedAt, closed.closedAt, closed.stage], ["2026-11-27T12:00:00.000Z", "2026-11-27T13:00:00.000Z", "closed"]);
    await defects.change("D-2", "closed");
    assert.deepEqual((await defects.list()).counts, { open: 0, toReplay: 0, closed: 2 });
    const again = await defects.change("D-1", "open");
    assert.deepEqual([again.status, again.fixedAt, again.closedAt, again.stage], ["open", undefined, undefined, "open"]);
    const list = await defects.list();
    assert.deepEqual([list.items.map(({ id }) => id), list.counts], [["D-2", "D-1"], { open: 1, toReplay: 0, closed: 1 }]);
    await assert.rejects(defects.change("D-9", "fixed"), UnknownDefectError);
  });

  it("count a defect fixed with those closed once its test passed in an execution after the fix", async () => {
    const store = new MemoryDefectStore();
    const report = { title: "The total is wrong", severity: "S1" as const, description: "", test: TEST };
    await new Defects(store, ran()).report(report);
    await store.set({ ...(await store.get("D-1"))!, status: "fixed", fixedAt: "2026-11-27T12:00:00.000Z" });
    // Before the fix, or another test of the file, or a failure, is no replay.
    const before = new Defects(
      store,
      ran(["2026-11-27T13:00:00.000Z", "failed"], ["2026-11-27T13:00:00.000Z", "passed", "Another test"], ["2026-11-27T11:00:00.000Z", "passed"]),
    );
    assert.equal((await before.list()).items[0]!.stage, "to_replay");
    const after = new Defects(store, ran(["2026-11-27T14:00:00.000Z", "passed"]));
    const list = await after.list();
    assert.deepEqual([list.items[0]!.stage, list.counts], ["replayed", { open: 0, toReplay: 0, closed: 1 }]);
  });
});
