import type { ExitCodeValue } from "@open-qa-stack/domain";
import { caught } from "./caught.ts";
import type { CommandIo, CommandOutput } from "./command-io.ts";
import type { Operations } from "./operations.ts";
import type { PrintingCommand } from "./printing-command.ts";
import { runPrinting } from "./run-printing.ts";

/** What a command that prints did, as the conversation tells it. */
export interface Printed {
  /** What it wrote, on either output, in order. */
  readonly text: string;
  /** The code it exits with. */
  readonly code: ExitCodeValue;
}

/**
 * Runs a command that prints as the command does, keeping what it writes instead of writing it: for the conversation,
 * which shows it in its thread. It is given no terminal nor input to read a value from.
 *
 * @param operations - The operations the conversation holds.
 * @param repository - Absolute path of the test repository.
 * @param command - What was typed after the slash.
 * @param io - The environment and the folder of the command.
 * @returns What it wrote, and its code: what it raised is told as the command tells it.
 */
export async function printedBy(operations: Operations, repository: string, command: PrintingCommand, io: CommandIo): Promise<Printed> {
  const written: string[] = [];
  const kept: CommandOutput = { write: (text) => written.push(text) };
  const { terminal: _terminal, input: _input, ...rest } = io;
  const captured: CommandIo = { ...rest, stdout: kept, stderr: kept };
  const code = await caught(() => runPrinting(operations, repository, command, { output: "text", follow: false, command }, captured), kept);
  return { text: written.join("").trimEnd(), code };
}
