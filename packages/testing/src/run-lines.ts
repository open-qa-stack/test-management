/** The date of the lines of the fixtures: some seconds after 09:00 on the day of the first run. */
export function at(seconds: number): string {
  return new Date(Date.parse("2026-11-14T09:00:00.000Z") + seconds * 1000).toISOString();
}

/**
 * Writes a line of a trace.
 *
 * @param seconds - When, in seconds after the start of the first run.
 * @param phase - Its phase.
 * @param actor - Who it is from.
 * @param event - What happened.
 * @param source - The source concerned, if any.
 * @returns The line, as the harness writes it, with its end.
 */
export function traced(seconds: number, phase: string, actor: "harness" | "agent", event: Readonly<Record<string, unknown>>, source?: string): string {
  return `${JSON.stringify({ at: at(seconds), phase, ...(source === undefined ? {} : { source }), actor, event })}\n`;
}

/**
 * Writes an entry of the journal of a run.
 *
 * @param seconds - When, in seconds after the start of the first run.
 * @param step - Its step.
 * @param event - What it is.
 * @param message - What happened.
 * @returns The entry, as the command writes it, with its end.
 */
export function entry(seconds: number, step: string, event: string, message: string): string {
  return `${JSON.stringify({ at: at(seconds), step, event, message })}\n`;
}

/**
 * Writes a line of the inbox of a run.
 *
 * @param seconds - When, in seconds after the start of the first run.
 * @param text - What the person says.
 * @returns The line, as the instance appends it, with its end.
 */
export function sent(seconds: number, text: string): string {
  return `${JSON.stringify({ at: at(seconds), text })}\n`;
}

/**
 * Writes the line the harness traces when it delivers a message of the person to the session of a phase.
 *
 * @param seconds - When, in seconds after the start of the first run.
 * @param phase - The phase of the session that received it.
 * @param message - The number of the message.
 * @param text - What the person said.
 * @returns The line, with its end.
 */
export function delivered(seconds: number, phase: string, message: number, text = "said"): string {
  return traced(seconds, phase, "harness", { type: "person", message, text });
}
