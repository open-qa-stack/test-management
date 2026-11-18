import type { TracePhase } from "../run/trace-line.ts";
import type { SessionPhase } from "../sessions/session-event.ts";

/** A step the run goes through around the agents: its journal alone tells it. */
export type CommandStep = Exclude<SessionPhase, TracePhase>;

/**
 * The phase an error of the journal is told under when its step is one the agents work in, whose phases the
 * journal does not name: the first phase of the cartography, the first of the design.
 */
export type RelayedPhase = "survey" | "plan";

/** What happened, as a line tells it: its type, then what that type carries. */
export type RunLineEvent = { readonly type: string } & Readonly<Record<string, unknown>>;

/**
 * A line a run wrote, as far as its thread reads it: a line of a trace, from the harness or from an agent, or
 * an entry of the journal about a step of the run.
 *
 * @remarks
 * It is read back from the text a run writes of it: its event is held to a type and nothing else, where a
 * `TraceLine` is what the harness writes. A line of a trace carries the event the harness or the agent
 * session reported: `started`, `finished`, `journal`, `message`, `person` and counts from the harness; `text`,
 * `reasoning`, `tool-call`, `tool-result`, `tool-error`, `end`, `stopped` and `error` from an agent. An entry
 * of the journal is read as `started` when it opens a step, and as `journal`, with its `level` and its
 * `message`, otherwise. Of the cartography and of the design, the journal gives its errors alone, as `journal`
 * under a {@link RelayedPhase}.
 */
export type RunLine = {
  /** When it was written, as an ISO 8601 date in UTC. */
  readonly at: string;
  /** The knowledge source concerned, when there is one. */
  readonly source?: string;
  readonly event: RunLineEvent;
} & ({ readonly actor: "command"; readonly phase: CommandStep | RelayedPhase } | { readonly actor: "harness" | "agent"; readonly phase: TracePhase });
