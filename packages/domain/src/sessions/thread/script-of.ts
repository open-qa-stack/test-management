import { hasEnded } from "../session-state.ts";
import type { Session } from "../session.ts";
import type { ActionLook, AgentRole, SessionEvent } from "../session-event.ts";
import type { ScriptWording } from "./script-wording.ts";
import type { SessionScript, SessionStage } from "./session-script.ts";
import { refusalParts } from "./refusal-parts.ts";
import { remarksOf } from "./remarks-of.ts";
import type { NoteStep, ProducedTest, RepeatedNoteStep, ReviewStep, Reviewer, Step, VerdictStep } from "./step.ts";

/** The agents a thread knows: what one it does not know says or does is left out, as any event it does not know. */
const AGENTS: ReadonlySet<string> = new Set<AgentRole>(["cartographer", "planner", "plan_reviewer", "writer", "coherence_reviewer", "code_reviewer"]);

/** The agents that review, whose verdict is a step of its own. */
const REVIEWERS: ReadonlySet<string> = new Set<Reviewer>(["plan_reviewer", "coherence_reviewer", "code_reviewer"]);

/** What a reviewer says once its verdict was taken, when it is the word the harness asks for: no space in it. */
const WORD = /^\S+$/;

/** A text on one line, for what a presentation draws as a title. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The title a file of tests gives each of its tests: `test("Search a customer", …)`. */
const DECLARED = /\btest\(\s*(["'`])((?:(?!\1).)+)\1/g;

/** The test a file is about: the title of the one test it declares, or the name of the file when it declares none or several. */
function subjectOf(file: ActionLook): string {
  const titles = [...file.lines.join("\n").matchAll(DECLARED)].map((declared) => declared[2]!);
  return titles.length === 1 ? titles[0]! : file.name.split("/").at(-1)!;
}

/** The test an action is about: that of the file it looked at, when it was one. */
function subjectIn(look: ActionLook | undefined): string | undefined {
  return look?.kind === "file" ? subjectOf(look) : undefined;
}

/** A note about a source, around the name of that source: what tells it alike another about another source. */
interface Alike {
  readonly before: string;
  readonly after: string;
  readonly source: string;
}

/** A note as what it says around the name of a source, when it names it. */
function alikeOf(text: string, source: string | undefined): Alike | undefined {
  if (source === undefined) return undefined;
  // The name as a word of its own, not a piece of another: `api` is not in `apis`, nor `a` in `card`.
  const named = new RegExp(`(?<![\\w-])${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).exec(text);
  return named === null ? undefined : { before: text.slice(0, named.index), after: text.slice(named.index + source.length), source };
}

/**
 * The step a note makes of the last one, the note before it: a row of notes alike, the same around the name of
 * their source, grows by it.
 */
function noted(last: Step, previous: Alike, note: NoteStep, alike: Alike | undefined): RepeatedNoteStep | undefined {
  if (alike === undefined || alike.before !== previous.before || alike.after !== previous.after) return undefined;
  if (last.kind === "repeated") return { ...last, sources: [...last.sources, alike.source], notes: [...last.notes, note] };
  return last.kind === "note"
    ? { kind: "repeated", at: last.at, before: alike.before, after: alike.after, sources: [previous.source, alike.source], notes: [last, note] }
    : undefined;
}

/** The time of an event, as a thread shows it. */
function clock(at: string): string {
  return at.slice(11, 19);
}

/** The name of a test as a person reads it: its title, the file and the project its runner prefixes it with left out. */
function testTitle(id: string): string {
  return id.split(" › ").at(-1)!;
}

/** Where a session is, for whoever reads its thread. */
function stageOf(session: Session): SessionStage {
  if (hasEnded(session.state)) return "ended";
  return session.state === "running" ? "live" : "queued";
}

/**
 * Reads the events of a session as the steps its thread shows, in the words of a presentation.
 *
 * @remarks
 * What the session works on is a step of its own, which a presentation shows at the head of the thread; a later turn
 * that works on the same tells it no more, and one that works on another tells it again. A phase starts a pass, a part of one when it reviews or writes a test, and none when it works on one source; a plan pass is
 * named after the level its request asks for. A message of the harness to an agent, of an agent, or of the
 * person is something said, and the delivery of a message the person sent during the session a step of its
 * own, so that a replay tells it when it happened; an action and its end are one step, worded as a sentence, pending until the tool
 * answered, with what the agent looked at — the file it handed the tool from the start, named after the test it
 * declares — and the verdict of each test a run ran; the call a reviewer hands its verdict in with is a review, its remarks
 * read from the arguments of the call, and what the harness answers and the word the reviewer replies with are kept
 * in it rather than told; a plan the harness accepted is told with each of its scenarios whole, and the refusals about each since its plan
 * started; a refusal is a verdict with its code, the scenario it is about and the parts of its text, a note a line of the harness. Each
 * turn of the session — what was asked, or what the person asked once it had ended, and the work it opened — closes with its end: on
 * the verdict of each test of the result its completion tells, or, when none ran, on the scenarios the harness closed in the turn; an
 * interruption is told. Every text is whole, as a person
 * needs it, since the end of a refusal says what to do; a title alone is put on one line.
 *
 * @param session - The session, as it was last told.
 * @param events - Its events, in order.
 * @param wording - The words of the presentation that shows the thread.
 * @returns The steps, with the title of the session: what was asked to open it, or when it was opened.
 */
export function scriptOf(session: Session, events: readonly SessionEvent[], wording: ScriptWording): SessionScript {
  const steps: Step[] = [];
  const actions = new Map<string, number>();
  /** The arguments of each action, by its identifier, which its title is worded from again once its end names its test. */
  const calls = new Map<string, unknown>();
  const sources = new Set<string>();
  const closed: ProducedTest[] = [];
  let asked: string | undefined;
  let plan: number | undefined;
  /** The scenario whose test is being written, which a reviewer of a test reviews. */
  let scenario: string | undefined;
  /** The knowledge source the work is on, when it is on one. */
  let source: string | undefined;
  /** The last note, around the name of its source, while it is the last step. */
  let previous: Alike | undefined;
  /** By reviewer, the rank of its verdict the harness just took, whose one-word reply is still to come. */
  const replies = new Map<string, number>();
  /** The scope last told, as a text that compares it with the next. */
  let scope: string | undefined;
  /** By scenario, the refusals of the harness about it since the plan of the pass started. */
  const refused = new Map<string, VerdictStep[]>();
  for (const event of events) {
    if (("agent" in event && !AGENTS.has(event.agent)) || ("to" in event && !AGENTS.has(event.to))) continue;
    const at = clock(event.at);
    switch (event.type) {
      case "user_message":
        // A message sent while the session goes on corrects its direction: it is not what the session is about.
        if (event.number === undefined) asked ??= event.text;
        steps.push({ kind: "say", from: "user", at, text: event.text, ...(event.number === undefined ? {} : { number: event.number }) });
        break;
      case "message_delivered":
        steps.push({ kind: "delivery", at, message: event.message, to: event.agent });
        break;
      case "agent_message": {
        const verdict = event.reasoning ? undefined : replies.get(event.agent);
        if (!event.reasoning) replies.delete(event.agent);
        if (verdict !== undefined && WORD.test(event.text.trim())) {
          steps[verdict] = { ...(steps[verdict] as ReviewStep), reply: event.text.trim() };
          break;
        }
        steps.push({ kind: "say", from: event.agent, at, text: event.text.trim(), ...(event.reasoning ? { thinking: true } : {}) });
        break;
      }
      case "harness_message":
        if (event.level !== undefined && plan !== undefined) steps[plan] = { ...steps[plan]!, title: `${wording.phase("plan")} · ${event.level}` } as Step;
        steps.push({ kind: "say", from: "harness", to: event.to, at, text: event.text.trim() });
        break;
      case "phase_started":
        // The work on one source is told by the notes of the harness, which name it: it starts no pass of its own.
        source = event.source;
        if (event.source !== undefined) sources.add(event.source);
        else {
          const part = event.phase === "review" || event.phase === "write";
          scenario = event.scenario;
          if (event.phase === "plan") {
            plan = steps.length;
            refused.clear();
          }
          steps.push({ kind: "pass", at, title: wording.phase(event.phase), summary: event.scenario ?? "", ...(part ? { minor: true } : {}) });
        }
        break;
      case "action_started": {
        actions.set(event.action, steps.length);
        replies.delete(event.agent);
        const remarks = REVIEWERS.has(event.agent) ? remarksOf(event.arguments) : undefined;
        if (remarks !== undefined) {
          steps.push({
            kind: "review",
            from: event.agent as Reviewer,
            at,
            ...(scenario === undefined ? {} : { scenario }),
            remarks,
            tool: event.tool,
            pending: true,
          });
          break;
        }
        calls.set(event.action, event.arguments);
        const subject = subjectIn(event.look);
        steps.push({
          kind: "tool",
          from: event.agent,
          at,
          tool: event.tool,
          title: oneLine(wording.tool(event.tool, event.arguments, subject)),
          ...(event.look === undefined ? {} : { look: event.look }),
          ...(subject === undefined ? {} : { subject }),
          pending: true,
        });
        break;
      }
      case "action_finished": {
        const index = actions.get(event.action);
        const started = index === undefined ? undefined : steps[index];
        if (index !== undefined && started?.kind === "review") {
          const { pending: _taken, ...review } = started;
          const refused = event.outcome === "failed";
          steps[index] = { ...review, answer: event.result.trim(), durationMs: event.durationMs, ...(refused ? { refused } : {}) };
          if (!refused) replies.set(review.from, index);
          break;
        }
        if (index === undefined || started?.kind !== "tool") break;
        const { pending: _answered, ...answered } = started;
        const look = event.look ?? answered.look;
        // A thread written before the start of an action showed its file tells it here only: the test is named now.
        const subject = answered.subject ?? subjectIn(look);
        steps[index] = {
          ...answered,
          ...(subject === undefined || subject === answered.subject
            ? {}
            : { title: oneLine(wording.tool(answered.tool, calls.get(event.action), subject)), subject }),
          detail: event.result.trim(),
          durationMs: event.durationMs,
          ...(event.outcome === "passed" || event.outcome === "failed" ? { outcome: event.outcome } : {}),
          ...(look === undefined ? {} : { look }),
          ...(event.tests === undefined ? {} : { tests: event.tests.map(({ id, verdict }) => ({ title: testTitle(id), verdict })) }),
        };
        break;
      }
      case "scope_resolved": {
        // Each turn resolves its scope again: one that the turn before already told adds nothing, and one that changed is told where it did.
        const told = JSON.stringify([event.environment, event.applications, event.levels]);
        if (told === scope) break;
        scope = told;
        steps.push({ kind: "scope", at, title: wording.scope, environment: event.environment, applications: event.applications, levels: event.levels });
        break;
      }
      case "plan_accepted":
        steps.push({
          kind: "plan",
          at,
          title: wording.planAccepted,
          scenarios: event.scenarios.map((planned) => ({ ...planned, refusals: refused.get(planned.id) ?? [] })),
        });
        refused.clear();
        break;
      case "refusal": {
        const text = event.text.trim();
        const verdict: VerdictStep = {
          kind: "verdict",
          at,
          accepted: false,
          ...(event.code === undefined ? {} : { code: event.code }),
          about: wording.phase(event.phase),
          ...(event.scenario === undefined ? {} : { scenario: event.scenario }),
          text,
          ...refusalParts(text),
        };
        if (event.scenario !== undefined) refused.set(event.scenario, [...(refused.get(event.scenario) ?? []), verdict]);
        steps.push(verdict);
        break;
      }
      case "note": {
        const note: NoteStep = { kind: "note", at, text: event.text.trim() };
        const alike = alikeOf(note.text, source);
        // A note came before this one: the thread holds a step.
        const row = previous === undefined ? undefined : noted(steps.at(-1)!, previous, note, alike);
        if (row === undefined) steps.push(note);
        else steps[steps.length - 1] = row;
        previous = alike;
        break;
      }
      case "scenario_closed":
        closed.push({ title: event.scenario, level: event.level ?? "", verdict: event.verdict });
        break;
      case "state_changed": {
        if (event.state === "interrupted") steps.push({ kind: "note", at, text: wording.interrupted });
        if (event.state !== "interrupted" && event.state !== "completed") break;
        // A turn closes on the verdict of each test of its result, or, when none ran, on the scenarios the harness closed in it.
        const tests = event.result?.tests ?? [];
        if (tests.length > 0)
          steps.push({
            kind: "outcome",
            at,
            title: wording.verdicts(tests.length),
            tests: tests.map(({ id, verdict, reason }) => ({ title: testTitle(id), level: "", verdict, note: reason })),
          });
        else if (closed.length > 0) steps.push({ kind: "outcome", at, title: wording.closed(closed.length), tests: [...closed] });
        closed.length = 0;
        break;
      }
    }
  }
  const opened = wording.opened(session.openedAt.slice(0, 10), clock(session.openedAt));
  return { id: session.id, title: oneLine(session.request ?? asked ?? opened), sources: [...sources], stage: stageOf(session), steps };
}
