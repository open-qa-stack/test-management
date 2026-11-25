import { EXECUTION_ORIGINS, type ExecutionOrigin, type ExecutionOutcome } from "@open-qa-stack/domain";
import type { Arguments } from "./arguments.ts";
import { commandOf } from "./command-of.ts";
import type { Command } from "./command.ts";
import { served } from "./ui-arguments.ts";

/** The options that take a value. */
const VALUED = [
  "--repository",
  "--environment",
  "--brief",
  "--output",
  "--host",
  "--port",
  "--provider",
  "--key-env",
  "--model",
  "--outcome",
  "--origin",
  "--before",
] as const;

/** The options that take none. */
const FLAGS = ["--help", "--follow", "--init", "--no-input", "--ui", "--github"] as const;

/** What `oqas model set` is told the connection with, which no other command takes. */
const MODEL_OPTIONS = "--github, --provider, --key-env and --model set the connection to the model: they go with oqas model set alone.";

/** What reading the arguments gives: them, or why they are refused. */
export type Parsed = { readonly ok: true; readonly arguments: Arguments } | { readonly ok: false; readonly error: string };

const refused = (error: string): Parsed => ({ ok: false, error });

/**
 * Reads the arguments of the command.
 *
 * @param argv - The arguments, without the program.
 * @returns The arguments, or why they are refused.
 */
export function parseArguments(argv: readonly string[]): Parsed {
  const values: {
    repository?: string;
    environment?: string;
    brief?: string;
    output?: string;
    host?: string;
    port?: string;
    provider?: string;
    "key-env"?: string;
    model?: string;
    outcome?: string;
    origin?: string;
    before?: string;
  } = {};
  const flags = new Set<string>();
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!;
    if (FLAGS.some((flag) => flag === argument)) flags.add(argument);
    else if (VALUED.some((option) => option === argument)) {
      const value = argv[i + 1];
      if (value === undefined || value.trim() === "" || value.startsWith("--")) return refused(`${argument} needs a value.`);
      values[argument.slice(2) as keyof typeof values] = value;
      i++;
    } else if (argument.startsWith("--")) return refused(`Unknown option ${argument}; see oqas --help.`);
    else words.push(argument);
  }
  const { repository, environment, brief, output = "text", host, port, provider, "key-env": keyEnv, model, outcome, origin, before } = values;
  if (output !== "text" && output !== "json") return refused("--output needs text or json.");
  const follow = flags.has("--follow");
  const help = flags.has("--help");
  const init = flags.has("--init");
  // The console is where the sessions are opened and read: beside it, nothing of a session nor of another command is taken.
  const beside = init || follow || words.length > 0 || [environment, brief, values.output].some((value) => value !== undefined);
  // The conversation asks on the terminal, and prints a screen, not lines: it goes with where it takes place, and with nothing else.
  const asks = !flags.has("--no-input") && !follow && values.output === undefined;
  const connection = { github: flags.has("--github"), provider, keyEnv, model };
  const command = flags.has("--ui") && !help ? served(beside, host, port) : commandOf(words, { environment, brief, follow, help, init, asks, connection });
  if (typeof command === "string") return refused(command);
  const setsTheModel = command.name === "model" && command.action === "set";
  if (!setsTheModel && command.name !== "help" && (connection.github || [provider, keyEnv, model].some((value) => value !== undefined)))
    return refused(MODEL_OPTIONS);
  const listsExecutions = command.name === "executions" && command.action === "list";
  if (!listsExecutions && command.name !== "help" && [outcome, origin, before].some((value) => value !== undefined))
    return refused("--outcome, --origin and --before choose the executions oqas executions lists: they go with it alone.");
  if (outcome !== undefined && outcome !== "failing" && outcome !== "passing") return refused("--outcome needs failing or passing.");
  if (origin !== undefined && !EXECUTION_ORIGINS.some((known) => known === origin)) return refused(`--origin needs ${EXECUTION_ORIGINS.join(" or ")}.`);
  if (command.name !== "ui" && command.name !== "help" && (host !== undefined || port !== undefined))
    return refused("--host and --port say where --ui listens: they go with it alone.");
  // An initialisation writes files and runs nothing: it takes the repository, and nothing of a session.
  if (command.name === "init" && (follow || values.output !== undefined))
    return refused("--init writes the files of the test repository and runs nothing: it takes --repository alone.");
  const listed: Command = listsExecutions
    ? {
        ...command,
        ...(outcome === undefined ? {} : { outcome: outcome as ExecutionOutcome }),
        ...(origin === undefined ? {} : { origin: origin as ExecutionOrigin }),
        ...(before === undefined ? {} : { before }),
      }
    : command;
  return { ok: true, arguments: { ...(repository === undefined ? {} : { repository }), output, follow, command: listed } };
}
