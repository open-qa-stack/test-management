import { isRecord, parseJson, textOf } from "../json.ts";
import { PERSON_TAG } from "../run/person-message.ts";
import type { Step } from "../run/run-entry.ts";
import type { TracePhase } from "../run/trace-line.ts";
import type { CommandStep, RelayedPhase, RunLine } from "./thread-line.ts";

const TRACED: readonly TracePhase[] = ["survey", "card", "consolidation", "index", "plan", "review", "write"];

const STEPS: readonly CommandStep[] = ["configuration", "prerequisites", "execution", "summary"];

/** The steps the agents work in, with the phase an error of their journal is told under. */
const RELAYED: ReadonlyMap<string, RelayedPhase> = new Map<Exclude<Step, CommandStep>, RelayedPhase>([
  ["cartography", "survey"],
  ["design", "plan"],
]);

const BRIEF = /<brief>\s*([^]*?)\s*<\/brief>/;

/** What opens the words of a person in a message of the harness, which ends with them. */
const PERSON_WORDS = `<${PERSON_TAG}`;

/** The date a line bears, in the one form dates are compared in; `undefined` when it bears none. */
function dateOf(value: unknown): string | undefined {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/**
 * Reads a line of a trace.
 *
 * @param text - The line, as the harness wrote it.
 * @returns The line; `undefined` for a text that is no JSON, or no line of a trace of a known phase.
 */
export function traceLine(text: string): RunLine | undefined {
  const line = parseJson(text);
  if (!isRecord(line)) return undefined;
  const { actor, event, source } = line;
  const at = dateOf(line["at"]);
  const phase = TRACED.find((known) => known === line["phase"]);
  if (at === undefined || phase === undefined || (actor !== "harness" && actor !== "agent") || !isRecord(event)) return undefined;
  const { type } = event;
  if (typeof type !== "string") return undefined;
  return { at, phase, actor, event: { ...event, type }, ...(typeof source === "string" ? { source } : {}) };
}

/**
 * Reads an entry of the journal of a run.
 *
 * @remarks
 * The traces of the cartography and of the design tell those steps line by line, so their entries are left
 * out, but their errors: the command journals some itself, around the agents, that no trace carries — what
 * stopped the design before a session started, for one. The thread leaves out those a trace told already.
 *
 * @param text - The entry, as the run wrote it.
 * @returns The entry as a line; `undefined` for a text that is no entry, and for an entry of the cartography or
 * of the design that is no error.
 */
export function journalLine(text: string): RunLine | undefined {
  const entry = parseJson(text);
  if (!isRecord(entry)) return undefined;
  const { step, event, message } = entry;
  const at = dateOf(entry["at"]);
  if (at === undefined || typeof step !== "string" || typeof message !== "string") return undefined;
  const level = event === "error" ? "error" : "info";
  const phase = STEPS.find((known) => known === step) ?? (level === "error" ? RELAYED.get(step) : undefined);
  if (phase === undefined) return undefined;
  if (event === "started") return { at, phase, actor: "command", event: { type: "started" } };
  return { at, phase, actor: "command", event: { type: "journal", level, message } };
}

/**
 * Finds the brief of the person in a line: the harness quotes it, between `<brief>` and `</brief>`, in the
 * request it sends to the agent that plans.
 *
 * @remarks
 * The harness ends a message with what the person sent while the run was going, and those words may hold
 * anything, the marks of a brief included. A brief is therefore only read before them: a message sent to
 * the run never passes for what opened it.
 *
 * @param line - The line.
 * @returns The brief, without the spaces around it; `undefined` when the line is no message of the harness or quotes none.
 */
export function briefOf(line: RunLine): string | undefined {
  if (line.actor !== "harness" || line.event.type !== "message") return undefined;
  const text = textOf(line.event["text"]);
  const quoted = BRIEF.exec(text);
  const person = text.indexOf(PERSON_WORDS);
  return quoted === null || (person >= 0 && person < quoted.index) ? undefined : quoted[1];
}
