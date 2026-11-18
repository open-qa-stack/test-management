import type { StopReason } from "../agent/task-limits.ts";
import type { UncoveredRequest } from "../test/test-plan.ts";
import type { TestVerdict } from "../test/test-verdicts.ts";
import type { ExitCodeValue } from "./exit-code.ts";
import type { Step } from "./run-entry.ts";

/** The state of a run, which the store of its host keeps once the run is over. */
export interface RunState {
  /** Version of the format of the state. */
  readonly formatVersion: 1;
  /** Identifier of the run: `oqas-` and its date. */
  readonly runId: string;
  /** The environment the run targeted. */
  readonly environment: string;
  /** What to test, in the developer's words, when it was given. */
  readonly brief?: string;
  /** When the run started, as an ISO 8601 date. */
  readonly startedAt: string;
  /** How long the run took, in milliseconds, up to the start of the summary. */
  readonly durationMs: number;
  /** The code the run ended with. */
  readonly exitCode: ExitCodeValue;
  /** Each step that ran, with how long it took and how many requests it sent to the model. */
  readonly steps: readonly { readonly step: Step; readonly durationMs: number; readonly modelRequests: number }[];
  /** The domain index, relative to the test repository, when it was written. */
  readonly index?: string;
  /** The local branch the tests were written on, when they were. */
  readonly branch?: string;
  /** The test files designed, relative to the test repository. */
  readonly designed: readonly string[];
  /** What the brief asks and the plan leaves out, because the application does not allow it, each with why; left out when the plan covers the brief. */
  readonly uncovered?: readonly UncoveredRequest[];
  /** The design state, relative to the test repository, when the design wrote it. */
  readonly designState?: string;
  /** The step a limit of the autonomy stopped, and the limit, when one stopped the run. */
  readonly stoppedBy?: { readonly step: "cartography" | "design"; readonly limit: StopReason["limit"] };
  /** The result of the run of the tests, relative to the test repository, when they ran. */
  readonly run?: string;
  /** The raw report of the runner, relative to the test repository, when the tests ran. */
  readonly report?: string;
  /** The verdict of each test, as the harness pronounced it, every secret masked in its reason. */
  readonly tests: readonly TestVerdict[];
  /** Where the journal of the run is kept, as the output of the journal names it: a path relative to the test repository when a file holds it. */
  readonly journal: string;
}
