import type { BatchEnd, DesignBatch } from "@open-qa-stack/domain";
import { countedTests, type DesignerOptions, type DesignOutcome } from "./designer.ts";
import { mergedOutcomes } from "./merged-outcomes.ts";
import type { DesignRun } from "./design-passes.ts";

/** What ends the batch of a design, the rounds it makes one after the other. */
export interface BatchLimits {
  /** The tests the batch may write; `null` for no bound. */
  readonly maxTests: number | null;
  /** The rounds in a row that may bring no new test. */
  readonly maxIdleRounds: number;
  /** When no round is started any more, in milliseconds since the epoch: the guardrail of the run. */
  readonly deadline: number;
  /** The clock, in milliseconds since the epoch. */
  readonly now: () => number;
}

/**
 * Designs the tests of a brief by rounds: each round is a design of its own, which plans what the tests of the
 * rounds before leave out, until the batch wrote the tests it may or its rounds bring nothing new.
 *
 * @remarks
 * A round is told its number, the scenarios the rounds before planned, and the scenarios its plan may hold:
 * what the batch may still write. A new test is one the round gave that passed, or fails because of the
 * application, at a path no round before gave. A round without one is idle; a round with one starts the
 * count of idle rounds again.
 *
 * The batch ends when it wrote the tests it may, after the idle rounds it may make in a row, when the
 * deadline passed before a round starts, or at a round a limit cut short, that could not start or that
 * repaired tests. Its first round is always made. The first three ends are those of a batch that went well:
 * what its rounds gave is given together, as the passes of a round give theirs. The visual tests, when the
 * design makes some, are one design after the last round, within the tests the batch may still write, unless
 * a round stopped the batch or the deadline passed.
 */
export class DesignRounds {
  readonly #options: DesignerOptions;
  readonly #limits: BatchLimits;
  readonly #round: DesignRun;
  readonly #visual: DesignRun | undefined;

  /**
   * @param options - What a design needs.
   * @param limits - What ends the batch.
   * @param round - Runs one round: the passes of a design, without its visual tests.
   * @param visual - Runs the design of the visual tests, when the design makes some.
   */
  public constructor(options: DesignerOptions, limits: BatchLimits, round: DesignRun, visual?: DesignRun) {
    this.#options = options;
    this.#limits = limits;
    this.#round = round;
    this.#visual = visual;
  }

  /**
   * Runs the rounds.
   *
   * @returns What they gave together, and how the batch went.
   */
  public async run(): Promise<DesignOutcome & { readonly batch: DesignBatch }> {
    const { maxTests, maxIdleRounds, deadline, now } = this.#limits;
    const seen = new Set<string>();
    const rounds: number[] = [];
    let merged: DesignOutcome = { ok: true, tests: [], journal: [] };
    let idle = 0;
    let endedBy: BatchEnd | undefined;
    const late = () => now() >= deadline;
    /** Runs one design of the batch, within the tests it may still write, and adds what it gave to the rest. */
    const design = async (run: DesignRun, changes: Partial<DesignerOptions>, name = `Round ${rounds.length + 1}`): Promise<DesignOutcome> => {
      const outcome = await run({
        ...this.#options,
        ...changes,
        planned: [...(this.#options.planned ?? []), ...(merged.planned ?? [])],
        ...(maxTests === null ? {} : { maxScenarios: maxTests - seen.size }),
      });
      const fresh = countedTests(outcome.tests).filter((test) => !seen.has(test.path));
      for (const test of fresh) seen.add(test.path);
      const said = { level: "info" as const, message: `${name}: ${fresh.length} new, ${seen.size}${maxTests === null ? "" : ` of ${maxTests}`} in the batch.` };
      rounds.push(fresh.length);
      merged = mergedOutcomes(merged, outcome, said);
      return outcome;
    };
    while (endedBy === undefined) {
      const outcome = await design(this.#round, { round: rounds.length + 1 });
      idle = rounds.at(-1) === 0 ? idle + 1 : 0;
      if (outcome.stoppedBy !== undefined || outcome.unstarted === true || outcome.repaired === true) endedBy = "stopped";
      else if (maxTests !== null && seen.size >= maxTests) endedBy = "tests";
      else if (idle >= maxIdleRounds) endedBy = "idle-rounds";
      else if (late()) endedBy = "guardrail";
    }
    // The visual tests build on every test the rounds gave: their design comes once, after the last round.
    if (this.#visual !== undefined && endedBy === "idle-rounds" && !late())
      await design(this.#visual, { round: rounds.length + 1, visual: true }, "Visual tests");
    return { ...merged, batch: { rounds, tests: seen.size, endedBy } };
  }
}
