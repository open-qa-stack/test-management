import type { ScenarioLevel } from "@open-qa-stack/domain";
import type { DesignerOptions, DesignOutcome } from "./designer.ts";

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
 * stops the passes: its design is the one a run resumes. A design resumed, or of one level, is one pass, as is one
 * the configuration asks in a single plan.
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
    // In a single plan the harness adds the visual tests itself; by level, they are a pass of their own.
    this.#options = visual ? { ...options, visual: "socle" } : options;
    this.#passes = passes;
    this.#design = design;
  }

  /**
   * Runs the passes.
   *
   * @returns What they gave together: the tests of each, in the order of the passes, the branch the last tests
   * were written on, and the state of the last pass that wrote one, which is the one to resume.
   */
  public async run(): Promise<DesignOutcome> {
    const asked = this.#options.levels ?? [];
    const levels = PYRAMID.filter((level) => asked.includes(level));
    if (this.#passes === "single" || this.#options.resume !== undefined) return this.#design(this.#options);
    // The visual tests come last, in a pass of their own: their agent builds on every test the levels gave.
    const { visual, ...leveled } = this.#options;
    const passes: DesignerOptions[] = [
      ...levels.map((level) => ({ ...leveled, levels: [level] })),
      ...(visual === undefined ? [] : [{ ...leveled, levels: ["functional" as const], visual: "pass" as const }]),
    ];
    if (passes.length < 2) return this.#design(this.#options);
    let merged: DesignOutcome = { ok: true, tests: [], journal: [] };
    for (const options of passes) {
      const pass = await this.#design(options);
      const name = options.visual === "pass" ? "visual" : options.levels![0]!;
      const said = { level: "info" as const, message: `Pass ${name}: ${pass.tests.length} ${pass.tests.length === 1 ? "test" : "tests"}.` };
      const uncovered = [...(merged.uncovered ?? []), ...(pass.uncovered ?? [])];
      merged = {
        ...merged,
        ...pass,
        ok: merged.ok && pass.ok,
        // A pass that wrote nothing leaves the branch and the state of the pass before as they are.
        ...(pass.branch === undefined && merged.branch !== undefined ? { branch: merged.branch } : {}),
        ...(pass.tests.length === 0 && merged.statePath !== undefined ? { statePath: merged.statePath, planPath: merged.planPath! } : {}),
        ...(uncovered.length === 0 ? {} : { uncovered }),
        tests: [...merged.tests, ...pass.tests],
        journal: [...merged.journal, ...pass.journal, said],
      };
      if (pass.stoppedBy !== undefined) break;
    }
    return merged;
  }
}
