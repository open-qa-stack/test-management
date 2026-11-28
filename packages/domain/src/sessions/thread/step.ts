import type { ActionLook, AgentRole, PlannedScenario, ResolvedScope, SessionPhase } from "../session-event.ts";
import type { RefusalParts } from "./refusal-parts.ts";

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

/** A test an action ran, with its verdict. */
export interface RanTest {
  /** Its title, the project and the file its runner prefixes it with left out. */
  readonly title: string;
  /** Its verdict, as the runner gave it: `passed`, `failed`… */
  readonly verdict: string;
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
  /** What the agent had before its eyes: the file it handed the tool, from the start, or the page the tool rendered. */
  readonly look?: ActionLook;
  /** The test the action is about, when the agent handed the tool the file of one: the title the file gives its test, or the name of the file. */
  readonly subject?: string;
  /** The tests the tool ran, each with its verdict, once it ran a file of tests. */
  readonly tests?: readonly RanTest[];
  /** Whether the tool has not answered yet. */
  readonly pending?: boolean;
  /** How long the tool took to answer, in milliseconds, once it did. */
  readonly durationMs?: number;
}

/**
 * The harness accepts or refuses what an agent handed in, on evidence. Its text is read by the form the harness
 * writes it in, so that a presentation shows its parts apart; the text itself is kept whole.
 */
export interface VerdictStep extends StepBase, RefusalParts {
  readonly kind: "verdict";
  readonly accepted: boolean;
  /** The code of the gate that refused, such as `PLAN-SHOWN`. */
  readonly code?: string;
  /** The phase it came in. */
  readonly about: string;
  /** The scenario it is about, when the thread tells it. */
  readonly scenario?: string;
  /** What the harness said, whole. */
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

/** A scenario of an accepted plan: all the plan says of it, and the refusals of the harness about it before the plan was accepted. */
export interface PlanScenario extends PlannedScenario {
  readonly refusals: readonly VerdictStep[];
}

/** The plan of a pass, once the harness accepted it: every scenario, with all the plan says of it. */
export interface PlanStep extends StepBase {
  readonly kind: "plan";
  readonly title: string;
  readonly scenarios: readonly PlanScenario[];
}

/** What the session works on, once the configuration of its run is resolved: told at the head of its thread. */
export interface ScopeStep extends StepBase, ResolvedScope {
  readonly kind: "scope";
  readonly title: string;
}

/** A pass starts: one loop of the agents for one level of the pyramid. */
export interface PassStep extends StepBase {
  readonly kind: "pass";
  /** The phase of the work it starts. */
  readonly phase: SessionPhase;
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

/**
 * The harness noted the same thing of several sources in a row, such as a card it kept because it was up to
 * date: one line for them all, each note kept.
 */
export interface RepeatedNoteStep extends StepBase {
  readonly kind: "repeated";
  /** What the notes say before the name of their source. */
  readonly before: string;
  /** What the notes say after the name of their source. */
  readonly after: string;
  /** The sources, in order: two or more. */
  readonly sources: readonly string[];
  /** Each note, in full. */
  readonly notes: readonly NoteStep[];
}

/** A step of a session, as its thread tells it. */
export type Step = SayStep | DeliveryStep | ToolStep | ReviewStep | VerdictStep | PlanStep | ScopeStep | PassStep | OutcomeStep | NoteStep | RepeatedNoteStep;
