import type { ActionLook, Session, SessionEvent, SessionPhase } from "@open-qa-stack/domain/sessions";
import { hasEnded } from "../api/session-state.ts";
import type { IconName } from "../ui/icon.tsx";
import type { Look, ProducedTest, SessionScript, SessionStage, Step } from "./session-script.ts";
import { IDENTITIES } from "./agents.ts";
import { toolTitle } from "./tool-title.ts";

/** Longest text of a message of the harness the thread shows as it is; an agent gets twice as much. */
const MAX_TEXT = 420;

/** Longest title of an action, arguments included. */
const MAX_TITLE = 96;

/** Longest answer of a tool the thread shows under its action. */
const MAX_DETAIL = 600;

/** How the start of each phase reads; a later version of the API may name another. */
const PHASES: Readonly<Record<string, string>> = {
  configuration: "Configuration",
  prerequisites: "Prérequis",
  survey: "Cartographie · sources",
  card: "Cartographie · fiche",
  consolidation: "Cartographie · domaines",
  index: "Cartographie · index",
  plan: "Plan",
  review: "Relecture du plan",
  write: "Écriture d’un test",
  execution: "Exécution des tests",
  summary: "Bilan",
};

/** How a phase reads; one this console does not know reads as a step of the work, without more. */
function phaseText(phase: SessionPhase): string {
  return PHASES[phase] ?? "Étape";
}

/** Cuts a text to a length, on one line when asked. */
function cut(text: string, length: number, oneLine = false): string {
  const kept = oneLine ? text.replace(/\s+/g, " ").trim() : text.trim();
  return kept.length > length ? `${kept.slice(0, length)}…` : kept;
}

/** The time of an event, as the thread shows it. */
function clock(at: string): string {
  return at.slice(11, 19);
}

/** The icon of a tool, from its name. */
function iconOf(tool: string): IconName {
  if (/run_test/.test(tool)) return "play";
  if (/propose_plan|report_duplicates|tests_list/.test(tool)) return "layers";
  if (/propose_test|tests_read/.test(tool)) return "pen";
  if (/_(goto|click|fill|select_option|check|snapshot|screenshot|requests|console)$/.test(tool)) return "web";
  if (/db|sql|query/.test(tool)) return "database";
  if (/knowledge|search|read|outline|list/.test(tool)) return "document";
  return "code";
}

/** What an agent had before its eyes, as the side of the session draws it. */
function lookOf(look: ActionLook): Look {
  return look.kind === "file"
    ? { kind: "code", file: look.name, lines: look.lines, caption: "Le test que l’agent a remis." }
    : { kind: "document", source: look.name, excerpt: look.lines, caption: "La page, telle que l’outil l’a rendue à l’agent." };
}

/** The name of a test as a person reads it: its title, the file and the project its runner prefixes it with left out. */
function testTitle(id: string): string {
  return id.split(" › ").at(-1)!;
}

/** When a session was opened, as its title gives it when nothing was asked. */
function openingOf(session: Session): string {
  return `Session du ${session.openedAt.slice(0, 10)} à ${clock(session.openedAt)} UTC`;
}

/** Where a session is, for whoever reads its thread. */
function stageOf(session: Session): SessionStage {
  if (hasEnded(session.state)) return "ended";
  return session.state === "running" ? "live" : "queued";
}

/**
 * Reads the events of a session as the steps its thread shows.
 *
 * @remarks
 * A phase starts a pass, a part of one when it reviews or writes a test, and none when it works on one source; a plan pass is
 * named after the level its request asks for. A message of the harness to an agent, of an agent, or of the
 * person is something said, and the delivery of a message the person sent during the session a step of its
 * own, so that a replay tells it when it happened; an action and its end are one step, worded as a sentence, pending until the tool
 * answered, with what the agent looked at; a plan the harness accepted is listed; a refusal is a verdict with
 * its code, a note a line of the harness. Once the session has ended it closes on the verdict of each test, or,
 * when none ran, on the scenarios the harness closed; an interruption is told. Long texts are cut.
 *
 * @param session - The session, as the API last told it.
 * @param events - Its events, in order.
 * @returns The steps, with the title of the session: what was asked to open it, or when it was opened.
 */
export function scriptOf(session: Session, events: readonly SessionEvent[]): SessionScript {
  const steps: Step[] = [];
  const actions = new Map<string, number>();
  const sources = new Set<string>();
  const closed: ProducedTest[] = [];
  let asked: string | undefined;
  let plan: number | undefined;
  for (const event of events) {
    // An agent the console does not know yet is left out, as any event it does not know.
    if (("agent" in event && !(event.agent in IDENTITIES)) || ("to" in event && !(event.to in IDENTITIES))) continue;
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
        steps.push({ kind: "say", from: event.agent, at, text: cut(event.text, MAX_TEXT * 2), ...(event.reasoning ? { thinking: true } : {}) });
        break;
      case "harness_message":
        if (event.level !== undefined && plan !== undefined) steps[plan] = { ...steps[plan]!, title: `${phaseText("plan")} · ${event.level}` } as Step;
        steps.push({ kind: "say", from: "harness", to: event.to, at, text: cut(event.text, MAX_TEXT) });
        break;
      case "phase_started":
        // The work on one source is told by the notes of the harness, which name it: it starts no pass of its own.
        if (event.source !== undefined) sources.add(event.source);
        else {
          const part = event.phase === "review" || event.phase === "write";
          if (event.phase === "plan") plan = steps.length;
          steps.push({ kind: "pass", at, title: phaseText(event.phase), summary: event.scenario ?? "", ...(part ? { minor: true } : {}) });
        }
        break;
      case "action_started":
        actions.set(event.action, steps.length);
        steps.push({
          kind: "tool",
          from: event.agent,
          at,
          icon: iconOf(event.tool),
          title: cut(toolTitle(event.tool, event.arguments), MAX_TITLE, true),
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
          detail: cut(event.result, MAX_DETAIL, true),
          durationMs: event.durationMs,
          ...(event.outcome === "passed" || event.outcome === "failed" ? { outcome: event.outcome } : {}),
          ...(event.look === undefined ? {} : { look: lookOf(event.look) }),
        };
        break;
      }
      case "plan_accepted":
        steps.push({
          kind: "plan",
          at,
          title: "Plan accepté par le harnais",
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
          about: phaseText(event.phase),
          text: cut(event.text, MAX_TEXT),
        });
        break;
      case "note":
        steps.push({ kind: "note", at, text: cut(event.text, MAX_TEXT, true) });
        break;
      case "scenario_closed":
        closed.push({ title: event.scenario, level: event.level ?? "", verdict: event.verdict });
        break;
      case "state_changed":
        if (event.state === "interrupted") steps.push({ kind: "note", at, text: "La session s’est arrêtée sans aller à son terme." });
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
      title: `Verdict de l’exécution : ${tests.length} test(s)`,
      tests: tests.map(({ id, verdict, reason }) => ({ title: testTitle(id), level: "", verdict, note: reason })),
    });
  } else if (stage === "ended" && last !== undefined && closed.length > 0) {
    steps.push({ kind: "outcome", at: last.at, title: `${closed.length} test(s) clos par le harnais`, tests: closed });
  }
  return { id: session.id, title: cut(session.request ?? asked ?? openingOf(session), 120, true), sources: [...sources], stage, steps };
}
