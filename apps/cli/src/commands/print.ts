import type { Command } from "../arguments/command.ts";
import type { Asked } from "./asked.ts";

/** The lines of a list, or what says it is empty. */
export function linesOr(lines: readonly string[], none: string): string {
  return lines.length === 0 ? none : lines.join("\n");
}

/** Writes a line to the standard output, as a text or as the JSON of a value. */
export function print({ options, io }: Pick<Asked<Command["name"]>, "options" | "io">, text: string, value: unknown): void {
  io.stdout.write(`${options.output === "json" ? JSON.stringify(value) : text}\n`);
}
