import type { SessionState } from "@open-qa-stack/shared/sessions";

/** Where a run is, as its files tell without being read: all that following its events needs to know of it. */
export interface RunProgress {
  readonly state: SessionState;
  /** When one of its files was last written, as an ISO 8601 date; its start when none is left. */
  readonly lastEventAt: string;
}
