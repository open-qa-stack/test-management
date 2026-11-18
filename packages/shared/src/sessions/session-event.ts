import type { SessionState } from "./session.ts";

/** An agent of a session. */
export type AgentRole = "cartographer" | "planner" | "plan_reviewer" | "writer" | "coherence_reviewer" | "code_reviewer";

/**
 * A phase of the work of a session: the steps of the run around the agents, the phases of the cartography,
 * then the plan, its reviews and the writing of each test.
 */
export type SessionPhase =
  "configuration" | "prerequisites" | "survey" | "card" | "consolidation" | "index" | "plan" | "review" | "write" | "execution" | "summary";

/** A scenario of a plan. */
export interface PlannedScenario {
  readonly id: string;
  readonly title: string;
  /** Its level of the test pyramid. */
  readonly level: string;
  /** The application it tests, when the plan says it. */
  readonly application?: string;
  /** The case it verifies, such as `nominal`, when the plan says it. */
  readonly case?: string;
}

/** What an agent had before its eyes when an action ended: the page a browser tool rendered, or the file it handed in. */
export interface ActionLook {
  readonly kind: "page" | "file";
  /** The address of the page, or the name of the file. */
  readonly name: string;
  /** Its first lines. */
  readonly lines: readonly string[];
}

/** What every event of a session carries. */
interface EventBase {
  /** Its rank in the session, from 1, growing: a client that reconnects asks for the events after the last it got. */
  readonly id: number;
  /** When it happened, as an ISO 8601 date. */
  readonly at: string;
}

/** The person asked something. */
export interface UserMessageEvent extends EventBase {
  readonly type: "user_message";
  readonly text: string;
}

/** An agent wrote something, or reasoned. */
export interface AgentMessageEvent extends EventBase {
  readonly type: "agent_message";
  readonly agent: AgentRole;
  readonly text: string;
  /** Whether it is a reasoning the agent kept to itself. */
  readonly reasoning: boolean;
}

/** The harness asked something of an agent: its request, then each reminder. */
export interface HarnessMessageEvent extends EventBase {
  readonly type: "harness_message";
  readonly to: AgentRole;
  readonly text: string;
  /** The level of the test pyramid the request asks a plan for, when it asks for one. */
  readonly level?: string;
}

/** A phase of the work started. */
export interface PhaseStartedEvent extends EventBase {
  readonly type: "phase_started";
  readonly phase: SessionPhase;
  /** The knowledge source the phase works on, when it works on one. */
  readonly source?: string;
  /** The scenario whose test the phase writes, when it writes one. */
  readonly scenario?: string;
}

/** An agent started an action: it called a tool. */
export interface ActionStartedEvent extends EventBase {
  readonly type: "action_started";
  /** The identifier of the action, which its end repeats. */
  readonly action: string;
  readonly agent: AgentRole;
  readonly tool: string;
  /** The arguments of the call, their long texts cut. */
  readonly arguments: unknown;
}

/** An action ended: the tool answered. */
export interface ActionFinishedEvent extends EventBase {
  readonly type: "action_finished";
  readonly action: string;
  /** `passed` or `failed` when the answer says so — a test that ran, a submission accepted or refused; `done` otherwise. */
  readonly outcome: "passed" | "failed" | "done";
  /** What the tool answered, cut when long. */
  readonly result: string;
  /** How long the action took, in milliseconds. */
  readonly durationMs: number;
  readonly look?: ActionLook;
}

/** The harness accepted a plan. */
export interface PlanAcceptedEvent extends EventBase {
  readonly type: "plan_accepted";
  readonly scenarios: readonly PlannedScenario[];
}

/** The harness refused what an agent handed in, or the work hit an error. */
export interface RefusalEvent extends EventBase {
  readonly type: "refusal";
  readonly phase: SessionPhase;
  /** The code of the gate that refused, such as `PLAN-ELEMENT`, when one did. */
  readonly code?: string;
  readonly text: string;
}

/** The harness noted something it did or saw. */
export interface NoteEvent extends EventBase {
  readonly type: "note";
  readonly phase: SessionPhase;
  readonly text: string;
}

/** The harness closed a scenario: its test is written, and ran. */
export interface ScenarioClosedEvent extends EventBase {
  readonly type: "scenario_closed";
  readonly scenario: string;
  /** Its level of the test pyramid, when the plan of the pass said it. */
  readonly level?: string;
  readonly verdict: "passed" | "failed";
}

/** The session changed state. */
export interface StateChangedEvent extends EventBase {
  readonly type: "state_changed";
  readonly state: SessionState;
}

/**
 * An event of the thread of a session. Types are added over time: a client ignores an event whose type it
 * does not know, and reads a value it does not know — a phase, an outcome — as it would an absent one.
 */
export type SessionEvent =
  | UserMessageEvent
  | AgentMessageEvent
  | HarnessMessageEvent
  | PhaseStartedEvent
  | ActionStartedEvent
  | ActionFinishedEvent
  | PlanAcceptedEvent
  | RefusalEvent
  | NoteEvent
  | ScenarioClosedEvent
  | StateChangedEvent;
