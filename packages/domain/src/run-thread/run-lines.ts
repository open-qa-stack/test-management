import { isRecord, parseJson } from "../json.ts";
import type { RunScope, Step } from "../run/run-entry.ts";
import type { TracePhase } from "../run/trace-line.ts";
import type { CommandStep, RelayedPhase, RunLine } from "./thread-line.ts";

const TRACED: readonly TracePhase[] = ["survey", "card", "consolidation", "index", "plan", "review", "write"];

const STEPS: readonly CommandStep[] = ["configuration", "prerequisites", "execution", "summary"];

/** The steps the agents work in, with the phase an error of their journal is told under. */
const RELAYED: ReadonlyMap<string, RelayedPhase> = new Map<Exclude<Step, CommandStep>, RelayedPhase>([
  ["cartography", "survey"],
  ["design", "plan"],
]);

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

/** The texts of a list, when it is one of texts alone. */
function textsOf(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string") ? value : undefined;
}

/** What a run works on, as an entry tells it; `undefined` when the entry tells none, or not in its form. */
function scopeOf(value: unknown): RunScope | undefined {
  if (!isRecord(value)) return undefined;
  const { environment } = value;
  const applications = textsOf(value["applications"]);
  const levels = textsOf(value["levels"]);
  return typeof environment === "string" && applications !== undefined && levels !== undefined ? { environment, applications, levels } : undefined;
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
 * @returns The entry as a line, with what the run works on when the entry tells it; `undefined` for a text that
 * is no entry, and for an entry of the cartography or of the design that is no error.
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
  const scope = scopeOf(entry["scope"]);
  return { at, phase, actor: "command", event: { type: "journal", level, message, ...(scope === undefined ? {} : { scope }) } };
}
