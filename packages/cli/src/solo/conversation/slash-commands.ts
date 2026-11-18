/** A command of the conversation, typed after a slash. */
export interface SlashCommand {
  readonly name: "sessions" | "new" | "stop" | "ui" | "help" | "quit";
  /** What it takes after its name, when it takes something. */
  readonly takes?: string;
  /** What it does, in a few words. */
  readonly does: string;
}

/** The commands of the conversation, in the order the help lists them. */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "sessions", does: "Pick a session and reopen its thread; one that goes on is followed" },
  { name: "new", does: "Go back to the start, to open another session" },
  { name: "stop", does: "Stop the session on screen, after a confirmation" },
  { name: "ui", takes: "[port]", does: "Serve the web console from this process and print its address" },
  { name: "help", does: "List the commands and the keys" },
  { name: "quit", does: "Leave the conversation" },
];

/**
 * Finds the commands a person may be typing.
 *
 * @param input - What the input holds.
 * @returns The commands whose name starts with the word typed after the slash, every one for a slash alone;
 * none when the input does not start with a slash, or already holds more than the name.
 */
export function hintedCommands(input: string): readonly SlashCommand[] {
  if (!input.startsWith("/") || /\s/.test(input)) return [];
  return SLASH_COMMANDS.filter(({ name }) => name.startsWith(input.slice(1)));
}
