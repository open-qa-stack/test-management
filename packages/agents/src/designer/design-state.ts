import type { Verdict } from "@open-qa-stack/domain";
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

/**
 * How a test stands: `passed` when its last run passed; `failing-application`, `failing-plan` or
 * `failing-test` when it is kept failing, by who is at fault; `unfinished` when its scenario was closed
 * before its test was made to end, the file being the last one the harness could keep; `duplicate` when
 * another test of the design already verifies what it does; `unfeasible` when the agent that writes it said,
 * with its reason, that no test can do what the scenario asks.
 */
export type TestClass = "passed" | `failing-${FailureCause}` | "unfinished" | "duplicate" | "unfeasible";

/** Who classed a test: the harness, with the check that decided, or an agent, with its role. */
export type ClassOrigin = { readonly by: "harness"; readonly check: string } | { readonly by: "agent"; readonly role: "writer" };

/** One classing of a test: the last of its list is how the test stands. */
export interface TestClassing {
  /** When it was classed, ISO 8601 in UTC. */
  readonly at: string;
  readonly class: TestClass;
  readonly origin: ClassOrigin;
  /** Why, in sentences: what the run showed, what the agent checked, or what was tried before the scenario was closed. */
  readonly reason: string;
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
  /** The verdict of the run of its text, as the harness pronounced it: `passed` or `failed`; `not_run` for an unfinished test whose text gave no verdict. */
  readonly verdict: Verdict;
  /** How it was classed, the oldest first: the last entry is how it stands. */
  readonly classes: readonly TestClassing[];
  /** Its runs while it was written, in order. */
  readonly runs: readonly DesignedRun[];
  /** For a test kept failing, why. */
  readonly quarantine?: Quarantine;
  /** For a test classed `duplicate`, the path of the test that already verifies what it does. */
  readonly duplicates?: string;
  /** The references of its visual comparisons, written with it, relative to the root of the test repository. */
  readonly references?: readonly string[];
  /** The code of the check the harness closed its scenario on, when it did: the gate that refused it five times, `TEST-STOP` when none of its runs gave a verdict, `SESSION-END` when its session ended first. */
  readonly closedBy?: string;
}

/** The state of a design, written next to the tests on their branch. */
export interface DesignState {
  readonly formatVersion: 4;
  /** Date and time of the design, ISO 8601 in UTC. */
  readonly producedAt: string;
  /** Name of the environment of the domain index. */
  readonly environment: string;
  /** The brief the design started from, in the developer's words, when one was given. */
  readonly brief?: string;
  /** Path of the file of the test plan accepted before the tests were written, relative to the root of the test repository, with forward slashes. */
  readonly plan: string;
  /** The branch the tests are written on; it is created with the first of them. */
  readonly branch: string;
  /** The revision the branch was created from. */
  readonly base: string;
  /** The model the tests were designed with, without any secret. */
  readonly model: IndexModel;
  /** What the sessions of the design used together, as the harness measured it. */
  readonly run: IndexRun;
  /** The test of each scenario closed, in the order of the plan. */
  readonly tests: readonly DesignedTest[];
}
