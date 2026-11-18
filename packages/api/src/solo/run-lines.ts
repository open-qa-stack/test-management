import { isRecord, parseJson, textOf } from "../json.ts";
import type { CommandStep, RunLine, TracedPhase } from "./run-line.ts";

const TRACED: readonly TracedPhase[] = ["survey", "card", "consolidation", "index", "plan", "review", "write"];

const STEPS: readonly CommandStep[] = ["configuration", "prerequisites", "execution", "summary"];

const BRIEF = /<brief>\s*([^]*?)\s*<\/brief>/;

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
 * @param text - The entry, as the command wrote it.
 * @returns The entry as a line; `undefined` for a text that is no entry, and for an entry of the cartography or
 * of the design, which their traces tell line by line.
 */
export function journalLine(text: string): RunLine | undefined {
  const entry = parseJson(text);
  if (!isRecord(entry)) return undefined;
  const { event, message } = entry;
  const at = dateOf(entry["at"]);
  const phase = STEPS.find((known) => known === entry["step"]);
  if (at === undefined || phase === undefined || typeof message !== "string") return undefined;
  if (event === "started") return { at, phase, actor: "command", event: { type: "started" } };
  return { at, phase, actor: "command", event: { type: "journal", level: event === "error" ? "error" : "info", message } };
}

/**
 * Finds the brief of the person in a line: the harness quotes it, between `<brief>` and `</brief>`, in the
 * request it sends to the agent that plans.
 *
 * @param line - The line.
 * @returns The brief, without the spaces around it; `undefined` when the line is no message of the harness or quotes none.
 */
export function briefOf(line: RunLine): string | undefined {
  if (line.actor !== "harness" || line.event.type !== "message") return undefined;
  return BRIEF.exec(textOf(line.event["text"]))?.[1];
}
