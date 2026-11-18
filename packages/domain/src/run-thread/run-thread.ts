import { isRecord, textOf } from "../json.ts";
import { plannedScenarioOf } from "./planned-scenario.ts";
import { RelayedErrors } from "./relayed-errors.ts";
import type { RunScope } from "../run/run-entry.ts";
import type { TracePhase } from "../run/trace-line.ts";
import type { ActionFinishedEvent, ActionLook, ActionTest, AgentRole, PlannedScenario } from "../sessions/session-event.ts";
import type { UnrankedEvent } from "../sessions/unranked-event.ts";
import type { CommandStep, RelayedPhase, RunLine, RunLineEvent } from "./thread-line.ts";

/**
 * Longest text an event holds, in characters: a message, a note, a refusal, the answer of a tool, a text of its
 * arguments, a page or a file it looked at. A thread is read by a person who needs it whole — the end of a
 * refusal says what to do — so this bound is no limit of what is shown: it only keeps a runaway, such as a
 * tool that answers with a whole dump, from making an event of many megabytes that every client that follows the
 * session receives. A longer text is cut, and the cut marked.
 */
const MAX_EVENT_TEXT = 1_048_576;

/** The agent that works in each phase but the review, which three agents share. */
const AGENTS: Readonly<Record<Exclude<TracePhase, "review">, AgentRole>> = {
  survey: "cartographer",
  card: "cartographer",
  consolidation: "cartographer",
  index: "cartographer",
  plan: "planner",
  write: "writer",
};

const OPENED = /^The scenario (\S+) was opened(?:; its test is (\S+)\.)?/;
const CLOSED = /^The scenario (\S+) was closed: (passed|failed)/;
const ACCEPTED = /^The plan was accepted: (.+)\.$/;
const CODED = /^\[([A-Z-]+)\] ([^]*)$/;
/** A scenario a text names by its identifier. */
const NAMED = /\bscenario ([a-z0-9]+(?:-[a-z0-9]+)*)/g;
const LEVEL = /\bof the level ([a-z-]+) alone/;
const FAILED = /(?:^(?:Refused|Warning) \()|(?:: failed\.)/;
const PASSED = /(?:^The plan was accepted)|(?:: passed\.)/;
/** The answer of a run of a file of tests, then the line of each test it ran: `- <project › file:line › title>: <verdict>.` */
const RAN = /^Run of the file: /;
const TEST = /^- (.+ › .+): ([a-z_]+)\.$/gm;

/** A tool call whose answer has not been read yet. */
interface PendingCall {
  readonly at: string;
  readonly tool: string;
  readonly arguments: unknown;
}

/** A text within {@link MAX_EVENT_TEXT}, whole when it is, its cut marked otherwise. */
function bounded(text: string): string {
  return text.length > MAX_EVENT_TEXT ? `${text.slice(0, MAX_EVENT_TEXT)}…` : text;
}

/** The arguments of a tool call, every text they hold, however deep, within {@link MAX_EVENT_TEXT}. */
function boundedArguments(value: unknown): unknown {
  if (typeof value === "string") return bounded(value);
  if (Array.isArray(value)) return value.map(boundedArguments);
  return isRecord(value) ? Object.fromEntries(Object.entries(value).map(([key, held]) => [key, boundedArguments(held)])) : value;
}

/** The lines of a page or of a file, all of them. */
function linesOf(text: string): string[] {
  return bounded(text).split("\n");
}

/** The page a tool rendered for the agent, named after its address, or after the tool when it gives none. */
function pageOf(tool: string, result: unknown): ActionLook | undefined {
  const page = isRecord(result) ? result["page"] : undefined;
  if (!isRecord(result) || typeof page !== "string") return undefined;
  const { url } = result;
  return { kind: "page", name: typeof url === "string" ? url : tool, lines: linesOf(page) };
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

/** The tests a run of a file of tests ran, each with its verdict; none for an answer that is no run. */
function testsOf(answer: string): ActionTest[] {
  return RAN.test(answer) ? [...answer.matchAll(TEST)].map(([, id, verdict]) => ({ id: textOf(id), verdict: textOf(verdict) })) : [];
}

/** How an action ended, when its answer says it. */
function outcomeOf(result: unknown): ActionFinishedEvent["outcome"] {
  const answer = answerOf(result);
  if ((isRecord(result) && typeof result["error"] === "string") || FAILED.test(answer)) return "failed";
  return PASSED.test(answer) ? "passed" : "done";
}

/**
 * The thread of a session, written from the lines of a run, read in the order of their dates: what a run
 * says, as the events of the contract of sessions, without their ranks, which whoever keeps the thread gives.
 *
 * @remarks
 * The line the harness traces when it hands a message of the person to the session of a phase is a
 * `message_delivered` to the agent of the phase; the message itself is told by whoever took it from the person.
 * A phase that starts is a `phase_started`, the writing of a test with the scenario the harness opened before.
 * What the harness sent an agent is a `harness_message` to the agent of the phase, the three reviewers told
 * apart by what the harness asks them, and the request of a plan gives the level it is asked for. What the
 * person asked is no event of the run: whoever took it from the person told it. What the harness or the command
 * journaled is a `note`, preceded by a `scope_resolved` for the entry that tells what the run works on, a `refusal` with its code for an error, and a `scenario_closed` when it closes a
 * scenario; an error the harness traced and the command relayed in its journal is told once. What the model wrote or thought is an `agent_message`. A tool call is an `action_started` and its
 * answer the `action_finished` of the same action: the start shows the file the agent hands the tool, which can
 * be read while the tool works, and the end the page the tool rendered and, for a run of a file of tests, the
 * verdict of each test it ran; a plan the harness accepted is followed by a `plan_accepted`. A task the harness stopped and
 * an error of an agent session are refusals. Nothing is worded here: every text is one the run wrote, whole, within
 * {@link MAX_EVENT_TEXT}.
 *
 * An agent builds a plan over several calls, and closes it with one that proposes nothing: the call the
 * harness accepts does not carry the plan. The scenarios of a `plan_accepted` are therefore those the agent
 * proposed since its plan phase started, a later one replacing an earlier one of the same identifier; when the
 * harness journaled which it accepted — `The plan was accepted: a, b.` — they are those it names, in that
 * order, since it may have refused or set aside the others in between.
 *
 * The end of a phase, the counts of the harness and the end of a turn are left out: the contract of the
 * events has no place for them.
 */
export class RunThread {
  #level: string | undefined;
  #scenario: string | undefined;
  #file: string | undefined;
  #reviewer: AgentRole = "plan_reviewer";
  readonly #calls = new Map<string, PendingCall>();
  readonly #errors = new RelayedErrors();
  /** The scenarios proposed since the plan phase started, by their identifiers. */
  #proposed = new Map<string, PlannedScenario>();
  /** The identifiers the harness named when it journaled that it accepted the plan. */
  #accepted: readonly string[] | undefined;

  /**
   * Reads the next line of the run.
   *
   * @param line - The line; lines are given in the order of their dates.
   * @returns The events it adds to the thread, in order; none for a line the thread does not tell.
   */
  add(line: RunLine): UnrankedEvent[] {
    const { at, event } = line;
    if (line.actor === "agent") return this.#acted(at, line.phase, event);
    if (event.type === "started") return [this.#started(line)];
    if (event.type === "journal") return this.#journaled(line);
    if (line.actor === "harness" && event.type === "person") return this.#delivered(at, line.phase, event["message"]);
    return line.actor === "harness" && event.type === "message" ? this.#asked(at, line.phase, textOf(event["text"])) : [];
  }

  #agent(phase: TracePhase): AgentRole {
    return phase === "review" ? this.#reviewer : AGENTS[phase];
  }

  /** The delivery of a message of the person to the agent of a phase; nothing when the line does not number the message. */
  #delivered(at: string, phase: TracePhase, message: unknown): UnrankedEvent[] {
    return typeof message === "number" ? [{ at, type: "message_delivered", message, agent: this.#agent(phase) }] : [];
  }

  #started({ at, phase, source }: RunLine): UnrankedEvent {
    if (phase === "plan") {
      this.#level = undefined;
      this.#unplanned();
    }
    const scenario = phase === "write" ? this.#scenario : undefined;
    return {
      at,
      type: "phase_started",
      phase,
      ...(source === undefined ? {} : { source }),
      ...(scenario === undefined ? {} : { scenario }),
    };
  }

  /** Forgets the plan being built: a plan phase starts from none, and so does what follows an accepted plan. */
  #unplanned(): void {
    this.#proposed = new Map();
    this.#accepted = undefined;
  }

  /**
   * Whether an error a line journals is still to be told: the command relays in its journal, under the name of
   * the source when there is one, the errors the harness traced.
   */
  #untold({ actor, source }: RunLine, message: string): boolean {
    if (actor === "command") return this.#errors.relayed(message);
    return this.#errors.traced(source === undefined ? message : `${source}: ${message}`);
  }

  #journaled(line: RunLine): UnrankedEvent[] {
    const { at, phase, event } = line;
    const message = textOf(event["message"]);
    const failed = event["level"] === "error";
    if (failed && !this.#untold(line, message)) return [];
    const accepted = ACCEPTED.exec(message);
    if (accepted !== null) this.#accepted = textOf(accepted[1]).split(", ");
    const opened = OPENED.exec(message);
    if (opened !== null) [, this.#scenario, this.#file] = opened;
    const closed = CLOSED.exec(message);
    if (closed !== null) {
      this.#scenario = undefined;
      this.#file = undefined;
      const verdict = closed[2] === "passed" ? "passed" : "failed";
      return [
        {
          at,
          type: "scenario_closed",
          scenario: textOf(closed[1]),
          ...(this.#level === undefined ? {} : { level: this.#level }),
          verdict,
        },
      ];
    }
    // What the run works on is read, in its form, from the entry of the journal that tells it.
    const scope = event["scope"] as RunScope | undefined;
    if (scope !== undefined)
      return [
        { at, type: "scope_resolved", ...scope },
        { at, type: "note", phase, text: bounded(message) },
      ];
    if (!failed) return [{ at, type: "note", phase, text: bounded(message) }];
    const coded = CODED.exec(message);
    if (coded === null) return [this.#refusal(at, phase, message)];
    return [{ ...this.#refusal(at, phase, textOf(coded[2])), code: textOf(coded[1]) }];
  }

  /**
   * A refusal, with the scenario it is about: the first the text names that the plan being built holds, or, while
   * the test of a scenario is written or reviewed, that one.
   */
  #refusal(at: string, phase: TracePhase | CommandStep | RelayedPhase, text: string): Extract<UnrankedEvent, { type: "refusal" }> {
    const named = [...text.matchAll(NAMED)].map(([, id]) => textOf(id)).find((id) => this.#proposed.has(id) || id === this.#scenario);
    const scenario = named ?? (phase === "write" || phase === "review" ? this.#scenario : undefined);
    return { at, type: "refusal", phase, text: bounded(text), ...(scenario === undefined ? {} : { scenario }) };
  }

  #asked(at: string, phase: TracePhase, text: string): UnrankedEvent[] {
    const events: UnrankedEvent[] = [];
    if (phase === "review") this.#reviewer = reviewerOf(text);
    const level = phase === "plan" ? LEVEL.exec(text)?.[1] : undefined;
    if (level !== undefined) this.#level = level;
    events.push({
      at,
      type: "harness_message",
      to: this.#agent(phase),
      text: bounded(text),
      ...(level === undefined ? {} : { level }),
    });
    return events;
  }

  #acted(at: string, phase: TracePhase, event: RunLineEvent): UnrankedEvent[] {
    const agent = this.#agent(phase);
    switch (event.type) {
      case "text":
      case "reasoning":
        return [{ at, type: "agent_message", agent, text: bounded(textOf(event["text"])), reasoning: event.type === "reasoning" }];
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
  #stopped(at: string, phase: TracePhase, why: unknown, key: string): UnrankedEvent {
    return this.#refusal(at, phase, textOf(isRecord(why) ? why[key] : why));
  }

  #called(at: string, agent: AgentRole, event: RunLineEvent): UnrankedEvent[] {
    const { callId: action, tool } = event;
    if (typeof action !== "string" || typeof tool !== "string") return [];
    this.#calls.set(action, { at, tool, arguments: event["arguments"] });
    const args = boundedArguments(event["arguments"]);
    if (tool === "propose_plan") for (const scenario of this.#scenarios(args)) this.#proposed.set(scenario.id, scenario);
    const look = this.#handed(tool, event["arguments"]);
    return [{ at, type: "action_started", action, agent, tool, arguments: args, ...(look === undefined ? {} : { look }) }];
  }

  #answered(at: string, action: unknown, result: unknown, failed: boolean): UnrankedEvent[] {
    const call = typeof action === "string" ? this.#calls.get(action) : undefined;
    if (typeof action !== "string" || call === undefined) return [];
    this.#calls.delete(action);
    const outcome = failed ? "failed" : outcomeOf(result);
    const look = failed ? undefined : pageOf(call.tool, result);
    const answer = bounded(answerOf(result));
    const tests = testsOf(answer);
    const finished: UnrankedEvent = {
      at,
      type: "action_finished",
      action,
      outcome,
      result: answer,
      durationMs: Date.parse(at) - Date.parse(call.at),
      ...(look === undefined ? {} : { look }),
      ...(tests.length === 0 ? {} : { tests }),
    };
    if (call.tool !== "propose_plan" || outcome !== "passed") return [finished];
    const scenarios = this.#accepted?.flatMap((id) => this.#proposed.get(id) ?? []) ?? [...this.#proposed.values()];
    this.#unplanned();
    return [finished, { at, type: "plan_accepted", scenarios }];
  }

  /** The file an agent hands a tool, named after the test being written, or after the tool when none is. */
  #handed(tool: string, args: unknown): ActionLook | undefined {
    const content = isRecord(args) ? args["content"] : undefined;
    return typeof content === "string" ? { kind: "file", name: this.#file ?? tool, lines: linesOf(content) } : undefined;
  }

  /** The scenarios of the plan a call proposed: those that bear an identifier and have a level, their own or that of the pass when they name none. */
  #scenarios(proposed: unknown): PlannedScenario[] {
    const scenarios = isRecord(proposed) ? proposed["scenarios"] : undefined;
    if (!Array.isArray(scenarios)) return [];
    return scenarios.flatMap((scenario: unknown) => plannedScenarioOf(scenario, this.#level) ?? []);
  }
}
