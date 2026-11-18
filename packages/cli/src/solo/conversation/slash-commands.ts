/** A command of the conversation, typed after a slash. */
export interface SlashCommand {
  readonly name: "sessions" | "new" | "stop" | "ui" | "help" | "quit";
  /** What it takes after its name, when it takes something. */
  readonly takes?: string;
}

/** The commands of the conversation, in the order the help lists them; what each does is in the resources, under its name. */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "sessions" },
  { name: "new" },
  { name: "stop" },
  { name: "ui", takes: "[port]" },
  { name: "help" },
  { name: "quit" },
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
