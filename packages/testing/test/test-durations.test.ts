import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { balancedParts, durationsOf, writeDurations } from "../src/test-durations.ts";

describe("the durations of the test files", () => {
  it("are read from a report by path from the root, to a tenth of a second, the longest run of a file run twice kept", () => {
    const report = {
      testResults: [
        { name: "/w/packages/b/test/b.test.ts", startTime: 1_000, endTime: 3_460 },
        { name: "/w/packages/a/test/a.test.ts", startTime: 0, endTime: 1_000 },
        { name: "/w/packages/a/test/a.test.ts", startTime: 0, endTime: 4_000 },
      ],
    };
    assert.deepEqual(Object.entries(durationsOf(report, "/w")), [
      ["packages/a/test/a.test.ts", 4],
      ["packages/b/test/b.test.ts", 2.5],
    ]);
  });

  it("are written from the file of a report, one by line", async () => {
    const folder = await mkdtemp(join(tmpdir(), "oqas-durations-"));
    try {
      const report = join(folder, "report.json");
      await writeFile(report, JSON.stringify({ testResults: [{ name: join(folder, "x.test.ts"), startTime: 0, endTime: 1_500 }] }));
      await writeDurations(report, join(folder, "durations.json"), folder);
      assert.equal(await readFile(join(folder, "durations.json"), "utf8"), '{\n  "x.test.ts": 1.5\n}\n');
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("split the files into parts of nearly the same length, the longest first, into the lightest part", () => {
    const durations = { a: 90, b: 80, c: 60, d: 40, e: 30, f: 10 };
    const paths = ["a", "b", "c", "d", "e", "f"];
    const parts = balancedParts(paths, durations, 2);
    assert.deepEqual(parts, [
      [0, 3, 4],
      [1, 2, 5],
    ]);
    const lengths = parts.map((ranks) => ranks.reduce((sum, rank) => sum + durations[paths[rank] as keyof typeof durations], 0));
    assert.deepEqual(lengths, [160, 150]);
  });

  it("count a file of unknown duration as the median one, every file the same when none is known, and keep a file run twice in two places", () => {
    assert.deepEqual(balancedParts(["long", "new", "short", "mid"], { long: 9, mid: 5, short: 1 }, 2), [
      [0, 2],
      [3, 1],
    ]);
    assert.deepEqual(balancedParts(["b", "a", "c"], {}, 2), [[1, 2], [0]]);
    assert.deepEqual(balancedParts(["same", "same"], { same: 3 }, 2), [[0], [1]]);
  });
});
