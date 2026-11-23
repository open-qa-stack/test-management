import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import type { TestSpecification, Vitest } from "vitest/node";
import { DURATIONS_FILE, DurationSequencer } from "../src/duration-sequencer.ts";

/** The parts of files a sequencer gives in a workspace, from the first to the last. */
async function partsIn(root: string, names: readonly string[], count: number): Promise<string[][]> {
  const files = names.map((name) => ({ moduleId: join(root, name) }) as TestSpecification);
  const parts: string[][] = [];
  for (let index = 1; index <= count; index++) {
    const sequencer = new DurationSequencer({ config: { root, shard: { index, count } } } as unknown as Vitest);
    parts.push((await sequencer.shard(files)).map(({ moduleId }) => moduleId.slice(root.length + 1)));
  }
  return parts;
}

describe("the parts of the tests", () => {
  it("are balanced by the durations the root of the workspace keeps, and are those of Vitest when it keeps none", async () => {
    const root = await mkdtemp(join(tmpdir(), "oqas-sequencer-"));
    try {
      const names = ["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts"];
      const vitest = await partsIn(root, names, 2);
      assert.deepEqual(vitest.flat().toSorted(), names, "Vitest's parts hold every file once");
      await writeFile(join(root, DURATIONS_FILE), JSON.stringify({ "a.test.ts": 50, "b.test.ts": 40, "c.test.ts": 30, "d.test.ts": 25 }));
      assert.deepEqual(await partsIn(root, names, 2), [
        ["a.test.ts", "d.test.ts"],
        ["b.test.ts", "c.test.ts"],
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
