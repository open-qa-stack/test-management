import { isRecord, textOf } from "../json.ts";
import { briefOf } from "./run-lines.ts";
import type { ActionFinishedEvent, ActionLook, AgentRole, PlannedScenario, SessionEvent, SessionState } from "@open-qa-stack/shared/sessions";
import type { RunLine, RunLineEvent, TracedPhase } from "./run-line.ts";

/** Longest text of a message, of a note or of a refusal; a longer one is cut. */
const MAX_TEXT = 2000;

/** Longest answer of a tool; a longer one is cut. */
const MAX_RESULT = 1000;

/** Most lines of a page or of a file an action shows. */
const MAX_LOOK_LINES = 28;

/** Longest line of a page or of a file an action shows; a longer one is cut. */
const MAX_LOOK_LINE = 240;

/** The agent that works in each phase but the review, which three agents share. */
const AGENTS: Readonly<Record<Exclude<TracedPhase, "review">, AgentRole>> = {
  survey: "cartographer",
  card: "cartographer",
  consolidation: "cartographer",
  index: "cartographer",
  plan: "planner",
  write: "writer",
};

const OPENED = /^The scenario (\S+) was opened(?:; its test is (\S+)\.)?/;
const CLOSED = /^The scenario (\S+) was closed: (passed|failed)/;
const CODED = /^\[([A-Z-]+)\] ([^]*)$/;
const LEVEL = /\bof the level ([a-z-]+) alone/;
const FAILED = /^(?:Refused|Warning) \(|: failed\./;
const PASSED = /^The plan was accepted|: passed\./;

/** A tool call whose answer has not been read yet. */
interface PendingCall {
  readonly at: string;
  readonly tool: string;
  readonly arguments: unknown;
}

/** Cuts a text that is longer than a length, and marks the cut. */
function cut(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

/**
 * Bounds the arguments of a tool call: every text they hold, however deep, is cut as a message is. An agent
 * hands whole files to its tools, and an event is sent to every client that follows the session.
 */
function bounded(value: unknown): unknown {
  if (typeof value === "string") return cut(value, MAX_TEXT);
  if (Array.isArray(value)) return value.map(bounded);
  return isRecord(value) ? Object.fromEntries(Object.entries(value).map(([key, held]) => [key, bounded(held)])) : value;
}

/** The first lines of a page or of a file, each cut when long. */
function firstLines(text: string): string[] {
  return text
    .split("\n")
    .slice(0, MAX_LOOK_LINES)
    .map((line) => cut(line, MAX_LOOK_LINE));
}

/** The reviewer the harness addresses, told by what it asks: a test to read, a scenario to compare, or a plan. */
function reviewerOf(request: string): AgentRole {
  if (request.startsWith("The test:")) return "code_reviewer";
  return request.startsWith("Scenario ") ? "coherence_reviewer" : "plan_reviewer";
}

/** What a tool answered, as a text: its error when it is one, the code it ran when it gives one, itself otherwise. */
function answerOf(result: unknown): string {
  if (!isRecord(result)) return textOf(result);
  const { error, code } = result;
  return typeof error === "string" ? error : textOf(code ?? result);
}

/** How an action ended, when its answer says it. */
function outcomeOf(result: unknown): ActionFinishedEvent["outcome"] {
  const answer = answerOf(result);
  if ((isRecord(result) && typeof result["error"] === "string") || FAILED.test(answer)) return "failed";
  return PASSED.test(answer) ? "passed" : "done";
}

/**
 * The thread of a session, written from the lines of a run of the command line, read in the order of their dates.
 *
 * @remarks
 * A phase that starts is a `phase_started`, the writing of a test with the scenario the harness opened before.
 * What the harness sent an agent is a `harness_message` to the agent of the phase, the three reviewers told
 * apart by what the harness asks them; the first request that quotes the brief of the person is preceded by a
 * `user_message`, and the request of a plan gives the level it is asked for. What the harness or the command
 * journaled is a `note`, a `refusal` with its code for an error, and a `scenario_closed` when it closes a
 * scenario. What the model wrote or thought is an `agent_message`. A tool call is an `action_started` and its
 * answer the `action_finished` of the same action, with what the agent looked at when the tool rendered a page
 * or took a file; a plan the harness accepted is followed by a `plan_accepted`. A task the harness stopped and
 * an error of an agent session are refusals. Nothing is worded here: every text is one the run wrote, cut when long.
 *
 * The end of a phase, the counts of the harness and the end of a turn are left out: the contract of the
 * events has no place for them.
 */
export class RunThread {
  #next = 1;
  #briefed = false;
  #level: string | undefined;
  #scenario: string | undefined;
  #file: string | undefined;
  #reviewer: AgentRole = "plan_reviewer";
  readonly #calls = new Map<string, PendingCall>();

  /**
   * Reads the next line of the run.
   *
   * @param line - The line; lines are given in the order of their dates.
   * @returns The events it adds to the thread, numbered after those before; none for a line the thread does not tell.
   */
  add(line: RunLine): SessionEvent[] {
    const { at, event } = line;
    if (line.actor === "agent") return this.#acted(at, line.phase, event);
    if (event.type === "started") return [this.#started(line)];
    if (event.type === "journal") return [this.#journaled(line)];
    return line.actor === "harness" && event.type === "message" ? this.#asked(at, line.phase, textOf(event["text"]), briefOf(line)) : [];
  }

  /**
   * Adds the change of state of the session to the thread.
   *
   * @param state - The state the session is in from now on.
   * @param at - When it changed, as an ISO 8601 date.
   * @returns The event, numbered after those before.
   */
  changed(state: SessionState, at: string): SessionEvent {
    return { id: this.#next++, at, type: "state_changed", state };
  }

  #agent(phase: TracedPhase): AgentRole {
    return phase === "review" ? this.#reviewer : AGENTS[phase];
  }

  #started({ at, phase, source }: RunLine): SessionEvent {
    if (phase === "plan") this.#level = undefined;
    const scenario = phase === "write" ? this.#scenario : undefined;
    return {
      id: this.#next++,
      at,
      type: "phase_started",
      phase,
      ...(source === undefined ? {} : { source }),
      ...(scenario === undefined ? {} : { scenario }),
    };
  }

  #journaled({ at, phase, event }: RunLine): SessionEvent {
    const message = textOf(event["message"]);
    const opened = OPENED.exec(message);
    if (opened !== null) [, this.#scenario, this.#file] = opened;
    const closed = CLOSED.exec(message);
    if (closed !== null) {
      this.#scenario = undefined;
      this.#file = undefined;
      const verdict = closed[2] === "passed" ? "passed" : "failed";
      return {
        id: this.#next++,
        at,
        type: "scenario_closed",
        scenario: textOf(closed[1]),
        ...(this.#level === undefined ? {} : { level: this.#level }),
        verdict,
      };
    }
    if (event["level"] !== "error") return { id: this.#next++, at, type: "note", phase, text: cut(message, MAX_TEXT) };
    const coded = CODED.exec(message);
    if (coded === null) return { id: this.#next++, at, type: "refusal", phase, text: cut(message, MAX_TEXT) };
    return { id: this.#next++, at, type: "refusal", phase, code: textOf(coded[1]), text: cut(textOf(coded[2]), MAX_TEXT) };
  }

  #asked(at: string, phase: TracedPhase, text: string, brief: string | undefined): SessionEvent[] {
    const events: SessionEvent[] = [];
    if (brief !== undefined && !this.#briefed) {
      this.#briefed = true;
      events.push({ id: this.#next++, at, type: "user_message", text: brief });
    }
    if (phase === "review") this.#reviewer = reviewerOf(text);
    const level = phase === "plan" ? LEVEL.exec(text)?.[1] : undefined;
    if (level !== undefined) this.#level = level;
    events.push({
      id: this.#next++,
      at,
      type: "harness_message",
      to: this.#agent(phase),
      text: cut(text, MAX_TEXT),
      ...(level === undefined ? {} : { level }),
    });
    return events;
  }

  #acted(at: string, phase: TracedPhase, event: RunLineEvent): SessionEvent[] {
    const agent = this.#agent(phase);
    switch (event.type) {
      case "text":
      case "reasoning":
        return [{ id: this.#next++, at, type: "agent_message", agent, text: cut(textOf(event["text"]), MAX_TEXT), reasoning: event.type === "reasoning" }];
      case "tool-call":
        return this.#called(at, agent, event);
      case "tool-result":
        return this.#answered(at, event["callId"], event["result"], false);
      case "tool-error":
        return this.#answered(at, event["callId"], event["message"], true);
      case "stopped":
        return [this.#stopped(at, phase, event["reason"], "limit")];
      case "error":
        return [this.#stopped(at, phase, event["error"], "message")];
      default:
        return [];
    }
  }

  /** The refusal a task that stopped or failed gives: what the run says of it under a key, or all it says. */
  #stopped(at: string, phase: TracedPhase, why: unknown, key: string): SessionEvent {
    return { id: this.#next++, at, type: "refusal", phase, text: cut(textOf(isRecord(why) ? why[key] : why), MAX_TEXT) };
  }

  #called(at: string, agent: AgentRole, event: RunLineEvent): SessionEvent[] {
    const { callId: action, tool } = event;
    if (typeof action !== "string" || typeof tool !== "string") return [];
    this.#calls.set(action, { at, tool, arguments: event["arguments"] });
    return [{ id: this.#next++, at, type: "action_started", action, agent, tool, arguments: bounded(event["arguments"]) }];
  }

  #answered(at: string, action: unknown, result: unknown, failed: boolean): SessionEvent[] {
    const call = typeof action === "string" ? this.#calls.get(action) : undefined;
    if (typeof action !== "string" || call === undefined) return [];
    this.#calls.delete(action);
    const outcome = failed ? "failed" : outcomeOf(result);
    const look = failed ? undefined : this.#look(call, result);
    const finished: SessionEvent = {
      id: this.#next++,
      at,
      type: "action_finished",
      action,
      outcome,
      result: cut(answerOf(result), MAX_RESULT),
      durationMs: Date.parse(at) - Date.parse(call.at),
      ...(look === undefined ? {} : { look }),
    };
    if (call.tool !== "propose_plan" || outcome !== "passed") return [finished];
    return [finished, { id: this.#next++, at, type: "plan_accepted", scenarios: this.#scenarios(call.arguments) }];
  }

  /** What the agent had before its eyes: the file it handed in, named after the test being written, or the page the tool rendered. */
  #look(call: PendingCall, result: unknown): ActionLook | undefined {
    const content = isRecord(call.arguments) ? call.arguments["content"] : undefined;
    if (typeof content === "string") return { kind: "file", name: this.#file ?? call.tool, lines: firstLines(content) };
    const page = isRecord(result) ? result["page"] : undefined;
    if (!isRecord(result) || typeof page !== "string") return undefined;
    const { url } = result;
    return { kind: "page", name: typeof url === "string" ? url : call.tool, lines: firstLines(page) };
  }

  /**
   * The scenarios of the plan a call proposed: those that bear an identifier and have a level, their own or
   * that of the pass when they name none.
   */
  #scenarios(proposed: unknown): PlannedScenario[] {
    const scenarios = isRecord(proposed) ? proposed["scenarios"] : undefined;
    if (!Array.isArray(scenarios)) return [];
    return scenarios.flatMap((scenario: unknown) => {
      if (!isRecord(scenario)) return [];
      const { id, title, application, case: verified } = scenario;
      const level = typeof scenario["level"] === "string" ? scenario["level"] : this.#level;
      if (typeof id !== "string" || level === undefined) return [];
      return [
        {
          id,
          title: typeof title === "string" ? title : id,
          level,
          ...(typeof application === "string" ? { application } : {}),
          ...(typeof verified === "string" ? { case: verified } : {}),
        },
      ];
    });
  }
}
