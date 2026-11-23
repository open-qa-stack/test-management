import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";
import { balancedParts, type TestDurations } from "./test-durations.ts";

/** The file of the root of the workspace that tells how long each test file took. */
export const DURATIONS_FILE = "test-durations.json";

/**
 * The order and the parts of the tests: Vitest's order, and parts of nearly the same length by the durations the root
 * of the workspace keeps, rather than by a hash of the paths; Vitest's parts when it keeps none.
 */
export class DurationSequencer extends BaseSequencer {
  public override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { root } = this.ctx.config;
    // Vitest asks for a part only when it was given one.
    const shard = this.ctx.config.shard!;
    const file = join(root, DURATIONS_FILE);
    if (!existsSync(file)) return super.shard(files);
    const durations = JSON.parse(readFileSync(file, "utf8")) as TestDurations;
    const parts = balancedParts(
      files.map(({ moduleId }) => relative(root, moduleId)),
      durations,
      shard.count,
    );
    return parts[shard.index - 1]!.map((rank) => files[rank]!);
  }
}
