import type { ScenarioLevel } from "@open-qa-stack/domain";
import { countedTests, type DesignerOptions, type DesignOutcome } from "./designer.ts";
import { mergedOutcomes } from "./merged-outcomes.ts";

/** The levels of the pyramid of tests, from its base to its top: the order the passes of a design are done in. */
export const PYRAMID: readonly ScenarioLevel[] = ["smoke", "functional", "business", "cross-application", "end-to-end"];

/** Runs one design: a plan, then the test of each of its scenarios. */
export type DesignRun = (options: DesignerOptions) => Promise<DesignOutcome>;

/**
 * Designs the tests of a brief level by level: for each level asked, from the base of the pyramid of tests
 * to its top, a design of its own — an agent that plans that level alone, then the agent that writes each of
 * its tests — and the next one only once it is over. The visual tests, when the design makes some, are a last
 * pass of their own.
 *
 * @remarks
 * Each pass commits its tests before the next one starts, on a branch made from that of the pass before: the
 * agent that plans a level is told the tests the levels below it gave, and a scenario one of them covers is
 * set aside, so that a level builds on those below instead of writing them again. A pass a limit cut short
 * stops the passes. With a single plan, the levels are one pass, and the visual tests another.
 *
 * When the scenarios a plan may hold are bounded, the bound is that of the passes together: each pass may plan
 * what the passes before left of it, counted by their tests that passed or fail because of the application,
 * and the passes stop once nothing is left. Each pass is told the scenarios those before it planned.
 */
export class DesignPasses {
  readonly #options: DesignerOptions;
  readonly #passes: "by-level" | "single";
  readonly #design: DesignRun;

  /**
   * @param options - What a design needs, with the levels asked.
   * @param passes - `by-level` for a pass per level; `single` for every level in one plan.
   * @param visual - Whether the design makes visual tests.
   * @param design - Runs one design, as `Designer` does.
   */
  public constructor(options: DesignerOptions, passes: "by-level" | "single", visual: boolean, design: DesignRun) {
    this.#options = visual ? { ...options, visual: true } : options;
    this.#passes = passes;
    this.#design = design;
  }

  /**
   * Runs the passes.
   *
   * @returns What they gave together: the tests of each, in the order of the passes, the branch the last tests
   * were written on, and the state of the last pass that wrote one.
   */
  public async run(): Promise<DesignOutcome> {
    const { levels: asked = [], visual, ...rest } = this.#options;
    const levels = PYRAMID.filter((level) => asked.includes(level));
    // By level, each level is a pass; in a single plan, all of them are one. The visual tests come last, in a pass of their own:
    // their agent builds on every test the others gave.
    const leveled: DesignerOptions[] =
      this.#passes === "single" || levels.length === 0 ? [{ ...rest, levels: asked }] : levels.map((level) => ({ ...rest, levels: [level] }));
    const passes: DesignerOptions[] = [...leveled, ...(visual === true ? [{ ...rest, levels: ["functional" as const], visual: true }] : [])];
    if (passes.length < 2) return this.#design(this.#options);
    let merged: DesignOutcome = { ok: true, tests: [], journal: [] };
    const { maxScenarios, planned = [] } = this.#options;
    for (const options of passes) {
      const left = maxScenarios === undefined ? undefined : maxScenarios - countedTests(merged.tests).length;
      // The passes together wrote what they may: the levels above are left to another batch.
      if (left !== undefined && left <= 0) break;
      const pass = await this.#design({
        ...options,
        ...(left === undefined ? {} : { maxScenarios: left }),
        planned: [...planned, ...(merged.planned ?? [])],
      });
      const name = options.visual === true ? "visual" : options.levels!.join(", ");
      const said = { level: "info" as const, message: `Pass ${name}: ${pass.tests.length} ${pass.tests.length === 1 ? "test" : "tests"}.` };
      merged = mergedOutcomes(merged, pass, said);
      // A pass cut short by a limit, or that could not start, leaves nothing the next could build on: they stop there. A repair is a whole design.
      if (pass.stoppedBy !== undefined || pass.unstarted === true || pass.repaired === true) break;
    }
    return merged;
  }
}
