import type { PlannedScenario, TestPlan, Verdict } from "@open-qa-stack/domain";
import type { ErrorClass } from "./run-failure.ts";
import { PROPOSE_TOOL, RUN_TOOL } from "./test-proposals.ts";

/** Most runs of the test of a scenario that may fail before it may not run again. */
export const MAX_FAILED_RUNS = 3;

/** A run of the test of a scenario. */
export interface ScenarioRun {
  /** The text that ran. */
  readonly content: string;
  /** Its verdict; none when it could not run. */
  readonly verdict?: Verdict;
  /** What it stopped on, when it failed. */
  readonly errorClass?: ErrorClass;
  /** The title of the `test.step` that failed, when one did. */
  readonly failedStep?: string;
  /** When it started, from which the logs of the services tell what happened. */
  readonly startedAt: string;
  /** How many times the agent had looked at the application, its logs or its code when it ran. */
  readonly looks: number;
}

/**
 * Where a design stands in its accepted plan: the scenario open, the file of its test, its runs, and the
 * line that names the next call.
 *
 * @remarks
 * Scenarios are open one at a time, in the order of the plan; the agent never names one. Each opened gets
 * its file from `place`, once.
 */
export class DesignCursor {
  /** The accepted plan, frozen. */
  public readonly plan: TestPlan;
  readonly #place: (scenario: PlannedScenario) => string;
  #at = 0;
  #path: string | undefined;
  #runs: ScenarioRun[] = [];

  /**
   * @param plan - The accepted plan.
   * @param place - Gives the file of the test of a scenario, relative to the test repository, when it opens.
   */
  public constructor(plan: TestPlan, place: (scenario: PlannedScenario) => string) {
    this.plan = plan;
    this.#place = place;
    this.#path = place(plan.scenarios[0]!);
  }

  /**
   * The scenario open.
   *
   * @returns It, or `undefined` once every scenario is closed.
   */
  public get scenario(): PlannedScenario | undefined {
    return this.plan.scenarios[this.#at];
  }

  /**
   * The rank of the scenario open in the plan, from 1.
   *
   * @returns The rank; one more than the number of scenarios once all are closed.
   */
  public get rank(): number {
    return this.#at + 1;
  }

  /**
   * The file of the test of the scenario open.
   *
   * @returns Its path, relative to the test repository; `undefined` once every scenario is closed.
   */
  public get path(): string | undefined {
    return this.#path;
  }

  /**
   * The runs of the test of the scenario open.
   *
   * @returns They, in order.
   */
  public get runs(): readonly ScenarioRun[] {
    return [...this.#runs];
  }

  /**
   * How many runs of the test of the scenario open did not pass.
   *
   * @returns The count.
   */
  public get failedRuns(): number {
    return this.#runs.filter((run) => run.verdict !== "passed").length;
  }

  /**
   * Counts a run of the test of a scenario, if that scenario is still the one open.
   *
   * @param scenario - Identifier of the scenario the run was made for.
   * @param run - The run.
   */
  public record(scenario: string, run: ScenarioRun): void {
    if (this.scenario?.id === scenario) this.#runs.push(run);
  }

  /** Closes the scenario open, and opens the next one. */
  public close(): void {
    this.#at += 1;
    this.#runs = [];
    const next = this.scenario;
    this.#path = next === undefined ? undefined : this.#place(next);
  }

  /**
   * The line that names the next call, which ends what the agent is told.
   *
   * @returns The line, starting with `Next:`.
   */
  public next(): string {
    const scenario = this.scenario;
    if (scenario === undefined) return "Next: answer with one sentence. Call no more tools.";
    const last = this.#runs.at(-1);
    if (last === undefined) return `Next: do the steps of ${scenario.id} with the browser tools, fill its skeleton with the code they return, then call ${RUN_TOOL}.`;
    if (last.verdict === "passed") return `Next: call ${PROPOSE_TOOL}.`;
    const failed = this.failedRuns;
    if (failed >= MAX_FAILED_RUNS) return `Next: call ${PROPOSE_TOOL} with diagnosis.`;
    return `Next: look at the page at the failed step, fix the locator or the wait, then call ${RUN_TOOL} with the whole corrected file (failed runs: ${failed} of ${MAX_FAILED_RUNS}).`;
  }
}
