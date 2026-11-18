import { hasEnded } from "../session-state.ts";
import type { Session } from "../session.ts";
import type { AgentRole, SessionEvent } from "../session-event.ts";
import type { ScriptWording } from "./script-wording.ts";
import type { SessionScript, SessionStage } from "./session-script.ts";
import type { ProducedTest, Step } from "./step.ts";

/** The agents a thread knows: what one it does not know says or does is left out, as any event it does not know. */
const AGENTS: ReadonlySet<string> = new Set<AgentRole>(["cartographer", "planner", "plan_reviewer", "writer", "coherence_reviewer", "code_reviewer"]);

/** A text on one line, for what a presentation draws as a title. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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
 * A phase starts a pass, a part of one when it reviews or writes a test, and none when it works on one source; a plan pass is
 * named after the level its request asks for. A message of the harness to an agent, of an agent, or of the
 * person is something said, and the delivery of a message the person sent during the session a step of its
 * own, so that a replay tells it when it happened; an action and its end are one step, worded as a sentence, pending until the tool
 * answered, with what the agent looked at; a plan the harness accepted is listed; a refusal is a verdict with
 * its code, a note a line of the harness. Once the session has ended it closes on the verdict of each test, or,
 * when none ran, on the scenarios the harness closed; an interruption is told. Every text is whole, as a person
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
  const sources = new Set<string>();
  const closed: ProducedTest[] = [];
  let asked: string | undefined;
  let plan: number | undefined;
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
      case "agent_message":
        steps.push({ kind: "say", from: event.agent, at, text: event.text.trim(), ...(event.reasoning ? { thinking: true } : {}) });
        break;
      case "harness_message":
        if (event.level !== undefined && plan !== undefined) steps[plan] = { ...steps[plan]!, title: `${wording.phase("plan")} · ${event.level}` } as Step;
        steps.push({ kind: "say", from: "harness", to: event.to, at, text: event.text.trim() });
        break;
      case "phase_started":
        // The work on one source is told by the notes of the harness, which name it: it starts no pass of its own.
        if (event.source !== undefined) sources.add(event.source);
        else {
          const part = event.phase === "review" || event.phase === "write";
          if (event.phase === "plan") plan = steps.length;
          steps.push({ kind: "pass", at, title: wording.phase(event.phase), summary: event.scenario ?? "", ...(part ? { minor: true } : {}) });
        }
        break;
      case "action_started":
        actions.set(event.action, steps.length);
        steps.push({
          kind: "tool",
          from: event.agent,
          at,
          tool: event.tool,
          title: oneLine(wording.tool(event.tool, event.arguments)),
          pending: true,
        });
        break;
      case "action_finished": {
        const index = actions.get(event.action);
        const started = index === undefined ? undefined : steps[index];
        if (index === undefined || started?.kind !== "tool") break;
        const { pending: _answered, ...answered } = started;
        steps[index] = {
          ...answered,
          detail: event.result.trim(),
          durationMs: event.durationMs,
          ...(event.outcome === "passed" || event.outcome === "failed" ? { outcome: event.outcome } : {}),
          ...(event.look === undefined ? {} : { look: event.look }),
        };
        break;
      }
      case "plan_accepted":
        steps.push({
          kind: "plan",
          at,
          title: wording.planAccepted,
          scenarios: event.scenarios.map((scenario) => ({
            priority: scenario.level,
            title: scenario.title,
            source: [scenario.case, scenario.application].filter((part) => part !== undefined).join(" · "),
          })),
        });
        break;
      case "refusal":
        steps.push({
          kind: "verdict",
          at,
          accepted: false,
          ...(event.code === undefined ? {} : { code: event.code }),
          about: wording.phase(event.phase),
          text: event.text.trim(),
        });
        break;
      case "note":
        steps.push({ kind: "note", at, text: event.text.trim() });
        break;
      case "scenario_closed":
        closed.push({ title: event.scenario, level: event.level ?? "", verdict: event.verdict });
        break;
      case "state_changed":
        if (event.state === "interrupted") steps.push({ kind: "note", at, text: wording.interrupted });
        break;
    }
  }
  const stage = stageOf(session);
  const last = steps.at(-1);
  const tests = session.result?.tests ?? [];
  if (stage === "ended" && last !== undefined && tests.length > 0) {
    steps.push({
      kind: "outcome",
      at: last.at,
      title: wording.verdicts(tests.length),
      tests: tests.map(({ id, verdict, reason }) => ({ title: testTitle(id), level: "", verdict, note: reason })),
    });
  } else if (stage === "ended" && last !== undefined && closed.length > 0) {
    steps.push({ kind: "outcome", at: last.at, title: wording.closed(closed.length), tests: closed });
  }
  const opened = wording.opened(session.openedAt.slice(0, 10), clock(session.openedAt));
  return { id: session.id, title: oneLine(session.request ?? asked ?? opened), sources: [...sources], stage, steps };
}
