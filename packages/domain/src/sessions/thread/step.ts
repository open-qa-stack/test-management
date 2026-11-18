import type { ActionLook, AgentRole } from "../session-event.ts";

/** Who speaks or acts in a session: the person who asked, one of the agents, or the harness that holds them to the evidence. */
export type Speaker = "user" | AgentRole | "harness";

/** What every step of a session carries. */
interface StepBase {
  /** The time of the step, as the thread shows it. */
  readonly at: string;
}

/** Someone says something: a message, or a reasoning the agent keeps to itself. */
export interface SayStep extends StepBase {
  readonly kind: "say";
  readonly from: Speaker;
  /** Whom the message is for, when it is for another agent. */
  readonly to?: Speaker;
  readonly text: string;
  /** Whether it is a reasoning, shown apart from what the agent says. */
  readonly thinking?: boolean;
  /** The number of a message the person sent while the session was going on; none for what opened it. */
  readonly number?: number;
}

/** A message the person sent while the session was going on reached an agent. */
export interface DeliveryStep extends StepBase {
  readonly kind: "delivery";
  /** The number of the message. */
  readonly message: number;
  /** The agent that received it. */
  readonly to: AgentRole;
}

/** An agent uses a tool: it reads, it opens a screen, it writes or runs a test. */
export interface ToolStep extends StepBase {
  readonly kind: "tool";
  readonly from: Speaker;
  /** The name of the tool, by which a presentation draws it. */
  readonly tool: string;
  /** What the agent did, in the past tense. */
  readonly title: string;
  /** What it got, on one line. */
  readonly detail?: string;
  /** How it ended, when the answer of the tool says so. */
  readonly outcome?: "passed" | "failed";
  /** What the agent had before its eyes when the tool answered. */
  readonly look?: ActionLook;
  /** Whether the tool has not answered yet. */
  readonly pending?: boolean;
  /** How long the tool took to answer, in milliseconds, once it did. */
  readonly durationMs?: number;
}

/** The harness accepts or refuses what an agent handed in, on evidence. */
export interface VerdictStep extends StepBase {
  readonly kind: "verdict";
  readonly accepted: boolean;
  /** The code of the gate that refused, such as `PLAN-SHOWN`. */
  readonly code?: string;
  /** What was handed in. */
  readonly about: string;
  /** Why, and what to do next. */
  readonly text: string;
}

/** The agents that review: the plan for duplicates, a test against its scenario, a test for the quality of its code. */
export type Reviewer = Extract<AgentRole, "plan_reviewer" | "coherence_reviewer" | "code_reviewer">;

/** A remark of a reviewer, as it gave it. */
export interface Remark {
  /** What is wrong, or why a scenario repeats one before it. */
  readonly text: string;
  /** Where, when the reviewer said it: a step of the test, an assertion. */
  readonly where?: string;
  /** The rule of the charter it breaks, when the reviewer named one. */
  readonly rule?: string;
  /** What it concerns, when the reviewer said it: `test`, which its writer can repair, or `plan`, which it cannot. */
  readonly concerns?: string;
  /** The scenario a reviewer of the plan found a duplicate, and what it repeats. */
  readonly duplicate?: { readonly scenario: string; readonly of: string };
}

/**
 * A reviewer hands in its verdict: its remarks, none when it found nothing. The call of the tool it reports with,
 * the answer of the harness and the word the reviewer replies with are the working of the review: they are kept
 * here, for whoever looks into it, and make no step of their own.
 */
export interface ReviewStep extends StepBase {
  readonly kind: "review";
  readonly from: Reviewer;
  /** The scenario whose test was reviewed; none when the plan was. */
  readonly scenario?: string;
  readonly remarks: readonly Remark[];
  /** The name of the tool the verdict was handed in with. */
  readonly tool: string;
  /** Whether the harness has not answered yet. */
  readonly pending?: boolean;
  /** Whether the harness refused the call: the verdict was not taken, and the reviewer is to hand it in again. */
  readonly refused?: boolean;
  /** What the harness answered the call. */
  readonly answer?: string;
  /** What the reviewer said once its verdict was taken: a word. */
  readonly reply?: string;
  /** How long the harness took to answer, in milliseconds. */
  readonly durationMs?: number;
}

/** A scenario of a plan, as a thread lists it. */
export interface ListedScenario {
  /** Its priority, such as `P0`, or its level when the plan gives no priority. */
  readonly priority: string;
  readonly title: string;
  /** Its case and the application it tests, when the plan says them. */
  readonly source: string;
}

/** The plan of a pass, once the harness accepted it. */
export interface PlanStep extends StepBase {
  readonly kind: "plan";
  readonly title: string;
  readonly scenarios: readonly ListedScenario[];
}

/** A pass starts: one loop of the agents for one level of the pyramid. */
export interface PassStep extends StepBase {
  readonly kind: "pass";
  /** Its phase, and its level once its request names it. */
  readonly title: string;
  /** The scenario the pass works on, when it works on one. */
  readonly summary: string;
  /** Whether it is a part of a pass, such as the writing of one test, which the progress of the session leaves out. */
  readonly minor?: boolean;
}

/** A test a session produced, with its verdict. */
export interface ProducedTest {
  readonly title: string;
  /** Its level of the pyramid, when the session says it. */
  readonly level: string;
  /** Its verdict, as the harness pronounced it: `passed`, `failed`, `blocked`… */
  readonly verdict: string;
  /** Why, when the harness said it. */
  readonly note?: string;
}

/** The session ends: what it produced. */
export interface OutcomeStep extends StepBase {
  readonly kind: "outcome";
  readonly title: string;
  readonly tests: readonly ProducedTest[];
}

/** The harness notes something it did or saw, without judging anything. */
export interface NoteStep extends StepBase {
  readonly kind: "note";
  readonly text: string;
}

/** A step of a session, as its thread tells it. */
export type Step = SayStep | DeliveryStep | ToolStep | ReviewStep | VerdictStep | PlanStep | PassStep | OutcomeStep | NoteStep;
