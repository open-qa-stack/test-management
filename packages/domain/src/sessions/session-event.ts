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

/** What an agent had before its eyes in an action: the file it handed a tool, or the page a browser tool rendered. */
export interface ActionLook {
  readonly kind: "page" | "file";
  /** The address of the page, or the name of the file. */
  readonly name: string;
  /** Its lines, all of them. */
  readonly lines: readonly string[];
}

/** A test a tool ran, with its verdict. */
export interface ActionTest {
  /** The test as its runner names it: the project, the file and its line, then its title, as `shop › tests/search.spec.ts:3 › searches a customer`. */
  readonly id: string;
  /** Its verdict, as the runner gave it: `passed`, `failed`… */
  readonly verdict: string;
}

/** What every event of a session carries. */
interface EventBase {
  /** Its rank in the session, from 1, growing: a client that reconnects asks for the events after the last it got. */
  readonly id: number;
  /** When it happened, as an ISO 8601 date. */
  readonly at: string;
}

/** The person said something: what opened the session, or a message sent while it was going on. */
export interface UserMessageEvent extends EventBase {
  readonly type: "user_message";
  readonly text: string;
  /** The number of a message sent while the session was going on, from 1; left out for what opened it. */
  readonly number?: number;
}

/** A message the person sent while the session was going on reached an agent. */
export interface MessageDeliveredEvent extends EventBase {
  readonly type: "message_delivered";
  /** The number of the message. */
  readonly message: number;
  /** The agent that received it. */
  readonly agent: AgentRole;
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
  /** The arguments of the call, whole. */
  readonly arguments: unknown;
  /** The file the agent hands the tool, such as the test it runs: it can be read while the tool works. */
  readonly look?: ActionLook;
}

/** An action ended: the tool answered. */
export interface ActionFinishedEvent extends EventBase {
  readonly type: "action_finished";
  readonly action: string;
  /** `passed` or `failed` when the answer says so — a test that ran, a submission accepted or refused; `done` otherwise. */
  readonly outcome: "passed" | "failed" | "done";
  /** What the tool answered, whole. */
  readonly result: string;
  /** How long the action took, in milliseconds. */
  readonly durationMs: number;
  /**
   * The page the tool rendered for the agent. A file the agent handed in is told by the start of the action; a
   * thread written before it was is told here.
   */
  readonly look?: ActionLook;
  /** The tests the tool ran, each with its verdict, when it ran a file of tests. */
  readonly tests?: readonly ActionTest[];
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
 * An event of the thread of a session. Its texts are whole: a client shows them as they are, and a person reads
 * them to the end; only a runaway of a megabyte or more is cut, the cut marked by an ellipsis. Types are added
 * over time: a client ignores an event whose type it does not know, and reads a value it does not know — a
 * phase, an outcome — as it would an absent one.
 */
export type SessionEvent =
  | UserMessageEvent
  | MessageDeliveredEvent
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
