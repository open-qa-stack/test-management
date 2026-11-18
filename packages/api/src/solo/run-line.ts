import type { SessionPhase } from "@open-qa-stack/shared/sessions";

/** A phase the agents work in: the harness traces it line by line. */
export type TracedPhase = "survey" | "card" | "consolidation" | "index" | "plan" | "review" | "write";

/** A step the command runs around the agents: its journal alone tells it. */
export type CommandStep = Exclude<SessionPhase, TracedPhase>;

/** What happened, as a line tells it: its type, then what that type carries. */
export type RunLineEvent = { readonly type: string } & Readonly<Record<string, unknown>>;

/**
 * A line a run of the command line wrote, as far as the instance reads it: a line of a trace, from the harness
 * or from an agent, or an entry of the journal about a step of the command.
 *
 * @remarks
 * A line of a trace carries the event the harness or the agent session reported: `started`, `finished`,
 * `journal`, `message` and counts from the harness; `text`, `reasoning`, `tool-call`, `tool-result`,
 * `tool-error`, `end`, `stopped` and `error` from an agent. An entry of the journal is read as `started` when
 * it opens a step, and as `journal`, with its `level` and its `message`, otherwise.
 */
export type RunLine = {
  /** When it was written, as an ISO 8601 date in UTC. */
  readonly at: string;
  /** The knowledge source concerned, when there is one. */
  readonly source?: string;
  readonly event: RunLineEvent;
} & ({ readonly actor: "command"; readonly phase: CommandStep } | { readonly actor: "harness" | "agent"; readonly phase: TracedPhase });
