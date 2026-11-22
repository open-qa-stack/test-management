/** A command the conversation does itself, typed after a slash. */
interface OwnCommand {
  readonly name: "sessions" | "new" | "stop" | "ui" | "help" | "quit";
  /** What it takes after its name, when it takes something. */
  readonly takes?: string;
}

/** A command of the conversation that runs what `oqas` runs, with the words typed after its name, which its help names. */
interface RunningCommand {
  readonly name: "model" | "config" | "knowledge" | "secrets" | "tests" | "launch" | "campaigns" | "executions" | "repository" | "init";
  readonly takes?: undefined;
  /** The arguments of the command it runs, which the words typed after its name follow. `/model` alone sets the connection step by step instead. */
  readonly runs: readonly string[];
}

/** A command of the conversation, typed after a slash. */
export type SlashCommand = OwnCommand | RunningCommand;

/** The commands of the conversation, in the order the help lists them; what each does is in the resources, under its name. */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "sessions" },
  { name: "new" },
  { name: "stop" },
  { name: "ui", takes: "[port]" },
  { name: "model", runs: ["model"] },
  { name: "config", runs: ["config"] },
  { name: "knowledge", runs: ["knowledge"] },
  { name: "tests", runs: ["tests"] },
  { name: "launch", runs: ["launch"] },
  { name: "campaigns", runs: ["campaigns"] },
  { name: "executions", runs: ["executions"] },
  { name: "secrets", runs: ["secrets"] },
  { name: "repository", runs: ["repository"] },
  { name: "init", runs: ["--init"] },
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
