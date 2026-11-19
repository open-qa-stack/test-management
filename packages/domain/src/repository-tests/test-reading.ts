import type { QaView } from "../report/qa-view.ts";

/** A test of the repository read in steps, from the latest run that ran it: what `GET /tests/reading` answers. */
export interface TestReading {
  /** Its path, relative to the root of the test repository. */
  readonly path: string;
  /** The run that ran it last, by the name of its folder in the state folder, such as `run-2026-11-19T00-29-03-488Z`. */
  readonly run?: string;
  /** When that run started, as an ISO 8601 date, read from the name of its folder. */
  readonly ranAt?: string;
  /** The test in steps, as that run reported it; none when no run kept ran it. */
  readonly view?: QaView;
}
