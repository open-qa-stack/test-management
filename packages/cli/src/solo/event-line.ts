import type { AgentRole, SessionEvent } from "@open-qa-stack/domain/sessions";

/** Longest text shown of what a tool was given, returned, or of what an agent, the harness or the person said. */
export const MAX_FOLLOWED_LENGTH = 160;

/** The events that tell what the agents do, step by step: they are printed when the thread is followed, and left out otherwise. */
const OF_THE_AGENTS: ReadonlySet<SessionEvent["type"]> = new Set(["agent_message", "harness_message", "action_started", "action_finished"]);

/**
 * Tells whether an event is one of the work of the agents, which a person asks to follow, or one the harness
 * tells of the session, which is always printed.
 *
 * @param event - An event of a session.
 * @returns Whether the event tells what an agent did, or what the harness asked of one.
 */
export function ofTheAgents(event: SessionEvent): boolean {
  return OF_THE_AGENTS.has(event.type);
}

/**
 * Writes an event of a session as a line a person reads in a terminal.
 *
 * @remarks
 * What the harness tells of a phase is written as the journal of a run always was: `[phase]`, then what
 * happened. What an agent or a person did is written after its time: a tool call with its arguments, `->`, its
 * answer, `<-`, or `!!` when it failed, each on one line and cut to {@link MAX_FOLLOWED_LENGTH} characters;
 * the event holds more. An event of a type this version does not know is written as its type.
 *
 * @param event - The event.
 * @returns The line, without its end.
 */
export function eventLine(event: SessionEvent): string {
  const time = event.at.slice(11, 19);
  switch (event.type) {
    case "phase_started":
      return `[${event.phase}] started${[event.source, event.scenario].map((named) => (named === undefined ? "" : `: ${named}`)).join("")}`;
    case "note":
      return `[${event.phase}] ${event.text}`;
    case "refusal":
      return `[${event.phase}] error: ${event.code === undefined ? "" : `[${event.code}] `}${event.text}`;
    case "user_message":
      return `${time} person${event.number === undefined ? "" : ` (message ${event.number})`}: ${shortened(event.text)}`;
    case "message_delivered":
      return `${time} message ${event.message} delivered to the ${named(event.agent)}`;
    case "agent_message":
      return `${time} ${named(event.agent)}${event.reasoning ? " thinks" : ""}: ${shortened(event.text)}`;
    case "harness_message":
      return `${time} harness to the ${named(event.to)}: ${shortened(event.text)}`;
    case "action_started":
      return `${time} ${named(event.agent)} -> ${event.tool}(${shortened(event.arguments)})`;
    case "action_finished":
      return `${time} ${event.outcome === "failed" ? "!!" : "<-"} ${shortened(event.result)}`;
    case "scope_resolved":
      return `[configuration] scope: environment ${event.environment}; applications ${event.applications.join(", ")}; levels ${event.levels.join(", ")}`;
    case "plan_accepted":
      return `${time} plan accepted: ${event.scenarios.map((scenario) => scenario.id).join(", ") || "no scenario"}`;
    case "scenario_closed":
      return `${time} scenario ${event.scenario} closed: ${event.verdict}`;
    case "state_changed":
      return `${time} session ${event.state}`;
    default:
      return `${time} ${(event as { readonly type: string }).type}`;
  }
}

/** An agent as a person reads its role. */
function named(agent: AgentRole): string {
  return agent.replaceAll("_", " ");
}

/**
 * Puts a value on one line a person reads.
 *
 * @param value - A text, or a value written as JSON.
 * @returns It on one line, cut to {@link MAX_FOLLOWED_LENGTH} characters with an ellipsis when it holds more.
 */
export function shortened(value: unknown): string {
  const text = (typeof value === "string" ? value : String(JSON.stringify(value))).replace(/\s+/g, " ").trim();
  return text.length > MAX_FOLLOWED_LENGTH ? `${text.slice(0, MAX_FOLLOWED_LENGTH)}…` : text;
}
