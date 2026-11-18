import type { AgentEvent } from "@open-qa-stack/domain";
import type { ModelUsage } from "./model-usage.ts";

/**
 * A phase of a run. Those of a cartography, in the order they run: checking the sources, a card per source,
 * the search for the domains, the index. Those of a design: `plan`, the session that plans, then `write`,
 * once for the session of each scenario; the lines of `review` are those of the sessions of the agent that
 * reviews the plan for duplicates, which run while the plan is submitted.
 */
export type TracePhase = "survey" | "card" | "consolidation" | "index" | "plan" | "review" | "write";

/** How a phase ended: `kept` for a card already up to date, `truncated` when a limit or a truncated source cut it short. */
export type PhaseOutcome = "done" | "kept" | "truncated" | "failed";

/** What the harness did, without the model. */
export type HarnessEvent =
  /** A phase starts, for one source or for the whole cartography. */
  | { readonly type: "started" }
  /** A phase that started is over. */
  | { readonly type: "finished"; readonly outcome: PhaseOutcome }
  /** Whether a source answered the check, and what its inventory counts when it is a knowledge source. */
  | { readonly type: "survey"; readonly answers: boolean; readonly items?: number; readonly error?: string }
  /** The inventory a card is made of: its elements and its fingerprint, read without the model. */
  | { readonly type: "inventory"; readonly items: number; readonly fingerprint: string; readonly truncated: boolean }
  /** An entry of the journal: a check, a refusal, a write. */
  | { readonly type: "journal"; readonly level: "info" | "error"; readonly message: string }
  /** A message the harness sent to the agent: the request, then each reminder. */
  | { readonly type: "message"; readonly text: string }
  /** A message of the person delivered to the session of the phase, by its number in the inbox of the run. */
  | { readonly type: "person"; readonly message: number; readonly text: string }
  /** What a phase, or the card of a source, asked of the model, just before its end. */
  | ({ readonly type: "usage" } & ModelUsage);

/** What the agent did, as its session reported it; a runtime error is reduced to its name and message. */
export type TracedAgentEvent =
  | Exclude<AgentEvent, { type: "error" }>
  | {
      readonly type: "error";
      readonly error: { readonly name: string; readonly message: string };
      readonly counters?: Extract<AgentEvent, { type: "error" }>["counters"];
    };

/** A line of the trace of a run. */
export type TraceLine = {
  /** When it was written, as an ISO 8601 date. */
  readonly at: string;
  /** The phase it belongs to. */
  readonly phase: TracePhase;
  /** The source concerned, when there is one. */
  readonly source?: string;
} & ({ readonly actor: "harness"; readonly event: HarnessEvent } | { readonly actor: "agent"; readonly event: TracedAgentEvent });
