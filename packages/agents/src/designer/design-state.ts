import type { TestPlan, Verdict } from "@open-qa-stack/domain";
import type { IndexModel, IndexRun } from "@open-qa-stack/shared";
import type { ErrorClass } from "./run-failure.ts";

/** Folder of the design states, in the state folder of the test repository. */
export const DESIGNS_FOLDER = "designs";

/** Who is at fault, for a test kept failing. */
export type FailureCause = "application" | "plan" | "test";

/** Why a test is kept failing, as the agent diagnosed it. */
export interface Quarantine {
  /** `application`: it does not do what the plan expects; `plan`: an expected text of the plan is wrong; `test`: the test could not be made to work. */
  readonly cause: FailureCause;
  /** What the run showed and what the agent checked. */
  readonly evidence: string;
  /** The title of the `test.step` the last run failed at, when it failed at one. */
  readonly failedStep?: string;
  /** What the last run stopped on. */
  readonly errorClass: ErrorClass;
}

/** A run of a test while it was written, as its design state lists it. */
export interface DesignedRun {
  /** Its verdict; none when it could not run. */
  readonly verdict?: Verdict;
  /** What it stopped on, when it failed. */
  readonly errorClass?: ErrorClass;
  /** The title of the `test.step` that failed, when one did. */
  readonly failedStep?: string;
}

/** A test the designer wrote, as its design state lists it; its application, its domain and its reason are those of its scenario. */
export interface DesignedTest {
  /** Path of the file, relative to the root of the test repository, with forward slashes. */
  readonly path: string;
  /** Identifier of the scenario of the plan the test carries out. */
  readonly scenario: string;
  /** The verdict of its last run, as the harness pronounced it: `passed` or `failed`. */
  readonly verdict: Verdict;
  /** Its runs while it was written, in order. */
  readonly runs: readonly DesignedRun[];
  /** For a test kept failing, why. */
  readonly quarantine?: Quarantine;
  /** The references of its visual comparisons, written with it, relative to the root of the test repository. */
  readonly references?: readonly string[];
}

/** The state of a design, written next to the tests on their branch. */
export interface DesignState {
  readonly formatVersion: 2;
  /** Date and time of the design, ISO 8601 in UTC. */
  readonly producedAt: string;
  /** Name of the environment of the domain index. */
  readonly environment: string;
  /** The brief the design started from, in the developer's words, when one was given. */
  readonly brief?: string;
  /** The test plan accepted before the tests were written. */
  readonly plan: TestPlan;
  /** The branch the tests were written on. */
  readonly branch: string;
  /** The revision the branch was created from. */
  readonly base: string;
  /** The model the tests were designed with, without any secret. */
  readonly model: IndexModel;
  /** What the task used, as the harness measured it. */
  readonly run: IndexRun;
  /** The tests written, in the order they were accepted. */
  readonly tests: readonly DesignedTest[];
}
