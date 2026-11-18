import type { Step } from "./step.ts";

/**
 * Where a session is for whoever reads its thread: `queued` while it waits its turn, `live` while its
 * agents work, `ended` once no step will come.
 */
export type SessionStage = "queued" | "live" | "ended";

/** A session of the agents, as its thread tells it, step by step. */
export interface SessionScript {
  /** The identifier of the session. */
  readonly id: string;
  /** What was asked, or when the session was opened when nothing was. */
  readonly title: string;
  /** The knowledge sources the agents read. */
  readonly sources: readonly string[];
  /** Where the session is: more steps may come until it ended. */
  readonly stage: SessionStage;
  readonly steps: readonly Step[];
}
