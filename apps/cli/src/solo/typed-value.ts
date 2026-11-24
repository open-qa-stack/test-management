import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { UsageError } from "./usage-error.ts";
import type { CommandIo } from "./command-io.ts";

/** What a command that reads a value is told when nothing gives it one. */
const NO_VALUE = 'No value was given: type it in a terminal, or give it on the input, as in: printf %s "$VALUE" | oqas secrets set <variable>.';

/**
 * Reads a value the person gives: typed in the terminal without being shown, or read from the input of the command
 * where there is no terminal, without its last line break. A value never comes from the arguments, which the history
 * of the shell and the list of the processes keep.
 *
 * @param io - The terminal and the input of the command.
 * @param prompt - What the terminal shows before the value is typed.
 * @returns The value.
 * @throws {@link UsageError} when the person stops typing with Ctrl-C, or no value is given.
 */
export async function typedValue(io: Pick<CommandIo, "terminal" | "input">, prompt: string): Promise<string> {
  return given(io.terminal === undefined ? await readAll(io.input) : await hidden(io.terminal, prompt));
}

/** The value read, refused when it is empty. */
function given(value: string): string {
  if (value === "") throw new UsageError(NO_VALUE);
  return value;
}

/** Reads all of an input, without its last line break; nothing without an input. */
async function readAll(input: AsyncIterable<string | Uint8Array> | undefined): Promise<string> {
  let text = "";
  const decoder = new TextDecoder();
  for await (const chunk of input ?? []) text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  return text.replace(/\r?\n$/, "");
}

/** Reads a line typed in a terminal, which echoes nothing of it. */
async function hidden(terminal: NonNullable<CommandIo["terminal"]>, prompt: string): Promise<string> {
  terminal.stdout.write(prompt);
  const echo = new Writable({ write: (_chunk, _encoding, done) => done() });
  const lines = createInterface({ input: terminal.stdin, output: echo, terminal: true });
  const stop = new AbortController();
  lines.on("SIGINT", () => stop.abort());
  try {
    return await lines.question("", { signal: stop.signal });
  } catch {
    throw new UsageError("Nothing was saved.");
  } finally {
    lines.close();
    terminal.stdout.write("\n");
  }
}
