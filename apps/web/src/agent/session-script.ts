import type { AgentRole } from "@open-qa-stack/shared/sessions";
import type { IconName } from "../ui/icon.tsx";

/** Who speaks or acts in a session: the person who asked, one of the agents, or the harness that holds them to the evidence. */
export type Speaker = "user" | AgentRole | "harness";

/** A file an agent reads or writes: its path and its lines. */
export interface CodeLook {
  readonly kind: "code";
  /** The path of the file. */
  readonly file: string;
  /** Its lines. */
  readonly lines: readonly string[];
  /** What the look shows, in a sentence. */
  readonly caption: string;
}

/** A text an agent reads: the page a browser tool rendered for it, a piece of knowledge. */
export interface DocumentLook {
  readonly kind: "document";
  /** Where the excerpt comes from. */
  readonly source: string;
  /** The excerpt. */
  readonly excerpt: readonly string[];
  /** What the look shows, in a sentence. */
  readonly caption: string;
}

/** What an agent looks at when it acts. */
export type Look = CodeLook | DocumentLook;

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
  readonly icon: IconName;
  /** What the agent did, in the past tense. */
  readonly title: string;
  /** What it got, in a sentence. */
  readonly detail?: string;
  /** How it ended, for a run of a test. */
  readonly outcome?: "passed" | "failed";
  /** What the agent looked at. */
  readonly look?: Look;
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

/** A scenario of a plan. */
export interface PlannedScenario {
  /** Its priority, such as `P0`, or its level when the plan gives no priority. */
  readonly priority: string;
  readonly title: string;
  /** Its level of the pyramid and where it comes from. */
  readonly source: string;
}

/** The plan of a pass, once the harness and the review accepted it. */
export interface PlanStep extends StepBase {
  readonly kind: "plan";
  readonly title: string;
  readonly scenarios: readonly PlannedScenario[];
}

/** A pass starts: one loop of the agents for one level of the pyramid. */
export interface PassStep extends StepBase {
  readonly kind: "pass";
  /** Its rank and its level, such as `Passe 1 · Smoke`. */
  readonly title: string;
  /** What the level makes of the request. */
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

/** A step of a session. */
export type Step = SayStep | DeliveryStep | ToolStep | VerdictStep | PlanStep | PassStep | OutcomeStep | NoteStep;

/** A session of the agents, as its thread tells it, step by step. */
export interface SessionScript {
  /** The identifier of the session. */
  readonly id: string;
  /** What was asked, or when the session was opened when nothing was. */
  readonly title: string;
  /** The knowledge sources the agents read. */
  readonly sources: readonly string[];
  /** Whether the session still goes on: more steps may come. */
  readonly live: boolean;
  readonly steps: readonly Step[];
}
