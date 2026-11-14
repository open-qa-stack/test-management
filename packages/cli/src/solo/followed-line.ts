import type { TraceLine } from "@open-qa-stack/agents";

/** Longest text shown of what a tool was given, returned, or of what an agent or the harness said. */
export const MAX_FOLLOWED_LENGTH = 160;

/**
 * Writes a line of the trace of a run as a person follows it: when, in which phase and for which source, then
 * what the agent did or what the harness told it.
 *
 * @remarks
 * A tool call is shown with its arguments, a result with its beginning, a refused call with its reason, each
 * on one line and cut to {@link MAX_FOLLOWED_LENGTH} characters; the trace keeps them whole. What the model
 * asked is shown at the end of each phase. The entries of the journal are left out: the journal prints them.
 * A line was written with the secrets of the configuration masked.
 *
 * @param line - The line of the trace.
 * @returns The line to print, without its end of line; `undefined` for a line that says nothing to follow.
 */
export function followedLine(line: TraceLine): string | undefined {
  const said = saidBy(line);
  if (said === undefined) return undefined;
  const where = line.source === undefined ? line.phase : `${line.phase} ${line.source}`;
  return `${line.at.slice(11, 19)} ${where} ${said}`;
}

function saidBy(line: TraceLine): string | undefined {
  const { event } = line;
  switch (event.type) {
    case "tool-call":
      return `-> ${event.tool}(${shortened(event.arguments)})`;
    case "tool-result":
      return `<- ${shortened(event.result)}`;
    case "tool-error":
      return `!! ${event.tool} (${event.reason}): ${shortened(event.message)}`;
    case "text":
      return `agent: ${shortened(event.text)}`;
    case "reasoning":
      return `agent thinks: ${shortened(event.text)}`;
    case "message":
      return `harness: ${shortened(event.text)}`;
    case "error":
      return `!! ${event.error.name}: ${shortened(event.error.message)}`;
    case "stopped":
      return `stopped by its ${event.reason.limit} limit`;
    case "usage":
      return event.inputTokens === undefined || event.outputTokens === undefined
        ? `${event.requests} model requests`
        : `${event.requests} model requests, ${event.inputTokens} tokens read, ${event.outputTokens} written`;
    default:
      return undefined;
  }
}

/** A value on one line, cut to the longest length shown. */
function shortened(value: unknown): string {
  const text = (typeof value === "string" ? value : String(JSON.stringify(value))).replace(/\s+/g, " ").trim();
  return text.length > MAX_FOLLOWED_LENGTH ? `${text.slice(0, MAX_FOLLOWED_LENGTH)}…` : text;
}
