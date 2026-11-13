import type { IndexModel, IndexRun } from "@open-qa-stack/shared";

/** Folder of the design states, in the state folder of the test repository. */
export const DESIGNS_FOLDER = "designs";

/** A test the designer wrote, as its design state lists it. */
export interface DesignedTest {
  /** Path of the file, relative to the root of the test repository, with forward slashes. */
  readonly path: string;
  /** Identifier of the application the test is about. */
  readonly application: string;
  /** Identifier of the domain of the index the test comes from. */
  readonly domain: string;
  /** Why the test is worth running, in one sentence. */
  readonly reason: string;
}

/** The state of a design, written next to the tests on their branch. */
export interface DesignState {
  readonly formatVersion: 1;
  /** Date and time of the design, ISO 8601 in UTC. */
  readonly producedAt: string;
  /** Name of the environment of the domain index. */
  readonly environment: string;
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
