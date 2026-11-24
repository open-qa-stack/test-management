import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";
import { balancedParts, longestFirst, type TestDurations } from "./test-durations.ts";

/** The file of the root of the workspace that tells how long each test file took. */
export const DURATIONS_FILE = "test-durations.json";

/**
 * The order and the parts of the tests, by the durations the root of the workspace keeps: the longest files first,
 * whatever their project, so that none is left to run alone at the end; and parts of nearly the same length, rather
 * than by a hash of the paths. Vitest's order and parts when it keeps none.
 */
export class DurationSequencer extends BaseSequencer {
  public override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const durations = this.#durations();
    if (durations === undefined) return super.shard(files);
    // Vitest asks for a part only when it was given one.
    const shard = this.ctx.config.shard!;
    const parts = balancedParts(this.#paths(files), durations, shard.count);
    return parts[shard.index - 1]!.map((rank) => files[rank]!);
  }

  public override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const durations = this.#durations();
    if (durations === undefined) return super.sort(files);
    return longestFirst(this.#paths(files), durations).map(({ rank }) => files[rank]!);
  }

  /** @returns The durations the root of the workspace keeps; none when it keeps none. */
  #durations(): TestDurations | undefined {
    const file = join(this.ctx.config.root, DURATIONS_FILE);
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as TestDurations) : undefined;
  }

  /** @returns The path of each file, from the root of the workspace. */
  #paths(files: readonly TestSpecification[]): string[] {
    return files.map(({ moduleId }) => relative(this.ctx.config.root, moduleId));
  }
}
