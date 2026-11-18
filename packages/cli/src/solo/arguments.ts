/** How a command prints what it tells: lines a person reads, or JSON Lines a program reads. */
export type Output = "text" | "json";

/** What the command is asked to do, with what that takes. */
export type Command =
  /** Print the usage. */
  | { readonly name: "help" }
  /** Initialise the test repository as a Playwright project. */
  | { readonly name: "init" }
  /** Open a session, and follow it to its end. */
  | { readonly name: "run"; readonly brief: string; readonly environment?: string }
  /** List the sessions. */
  | { readonly name: "sessions" }
  /** Print a session and its thread so far. */
  | { readonly name: "show"; readonly session: string }
  /** Follow a session to its end. */
  | { readonly name: "attach"; readonly session: string }
  /** Say something to a session that goes on. */
  | { readonly name: "say"; readonly session: string; readonly text: string }
  /** Interrupt a session that goes on. */
  | { readonly name: "stop"; readonly session: string };

/** The arguments of the command, once read. */
export interface Arguments {
  /** The test repository; the current folder by default. */
  readonly repository?: string;
  /** How the command prints what it tells. */
  readonly output: Output;
  /** Whether to print what the agents do, besides what the harness tells of the session. */
  readonly follow: boolean;
  readonly command: Command;
}

/** The commands on a session that exists, with the words each takes after its name. */
const ON_SESSIONS = { sessions: [], show: ["<session>"], attach: ["<session>"], say: ["<session>", "<text>"], stop: ["<session>"] } as const;

/** The options that take a value. */
const VALUED = ["--repository", "--environment", "--brief", "--output"] as const;

/** How to run the command, as `oqas --help` prints it. */
export const USAGE = `Usage: oqas [--repository <folder>] [--environment <name>] --brief <text> [--follow] [--output text|json] [--no-input]
       oqas [--repository <folder>] sessions [--output text|json]
       oqas [--repository <folder>] show <session> [--follow] [--output text|json]
       oqas [--repository <folder>] attach <session> [--follow] [--output text|json]
       oqas [--repository <folder>] say <session> <text> [--output text|json]
       oqas [--repository <folder>] stop <session> [--output text|json]
       oqas [--repository <folder>] --init

With --brief, opens a session: maps the target application, designs Playwright tests on a new local branch, runs
them and gives a verdict per test. The other commands read the sessions of the test repository and act on one,
from any terminal: <session> is its identifier, or the start or the end of it when no other session shares it.

Commands:
  sessions               List the sessions, the latest first.
  show <session>         Print a session and its thread so far.
  attach <session>       Follow a session to its end, as the command that opened it does.
  say <session> <text>   Say something to the agents of a session that goes on.
  stop <session>         Interrupt a session that goes on.

Options:
  --repository <folder>  The test repository, which holds oqas.json; the current folder by default.
  --environment <name>   The environment to run against; the only one declared by default.
  --brief <text>         What to test, in your words: a domain, a ticket, a rule, a journey.
  --follow               Print what the agents do besides what the harness tells: each tool call, its result, each message.
  --output text|json     How to print: lines to read, the default, or JSON Lines, one event of the session a line.
  --no-input             Never ask anything on the terminal. The command asks nothing yet: the option is accepted for the scripts that set it.
  --init                 Initialise the test repository as a Playwright project, from its oqas.json: write the files it
                         lacks, overwrite none, run nothing.
  --help                 Print this help.

Exit codes of a session followed to its end: 0 every test passed, 1 a test failed, 2 a test was blocked,
indeterminate, skipped or not run, 3 the configuration or the arguments are invalid, 4 a prerequisite is missing,
5 the session did not go to its end. The other commands exit with 0, with 3 when they are refused, with 5 when they fail.
`;

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
  const values: { repository?: string; environment?: string; brief?: string; output?: string } = {};
  const flags = new Set<string>();
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!;
    if (argument === "--help" || argument === "--follow" || argument === "--init" || argument === "--no-input") flags.add(argument);
    else if (VALUED.some((option) => option === argument)) {
      const value = argv[i + 1];
      if (value === undefined || value.trim() === "" || value.startsWith("--")) return refused(`${argument} needs a value.`);
      values[argument.slice(2) as keyof typeof values] = value;
      i++;
    } else if (argument.startsWith("--")) return refused(`Unknown option ${argument}; see oqas --help.`);
    else words.push(argument);
  }
  const { repository, environment, brief, output = "text" } = values;
  if (output !== "text" && output !== "json") return refused("--output needs text or json.");
  const follow = flags.has("--follow");
  const command = commandOf(words, { environment, brief, follow, help: flags.has("--help"), init: flags.has("--init") });
  if (typeof command === "string") return refused(command);
  // An initialisation writes files and runs nothing: it takes the repository, and nothing of a session.
  if (command.name === "init" && (follow || values.output !== undefined))
    return refused("--init writes the files of the test repository and runs nothing: it takes --repository alone.");
  return { ok: true, arguments: { ...(repository === undefined ? {} : { repository }), output, follow, command } };
}

/** What the words and the options of a session ask for, or why they ask for nothing the command does. */
function commandOf(
  words: readonly string[],
  options: {
    readonly environment: string | undefined;
    readonly brief: string | undefined;
    readonly follow: boolean;
    readonly help: boolean;
    readonly init: boolean;
  },
): Command | string {
  const { environment, brief, follow, help, init } = options;
  if (help) return { name: "help" };
  const opens = environment !== undefined || brief !== undefined;
  const [name, ...rest] = words;
  if (init)
    return opens || name !== undefined ? "--init writes the files of the test repository and runs nothing: it takes --repository alone." : { name: "init" };
  if (name === undefined) {
    if (brief === undefined) return "Say what to test with --brief, or name a command; see oqas --help.";
    return { name: "run", brief, ...(environment === undefined ? {} : { environment }) };
  }
  if (!Object.hasOwn(ON_SESSIONS, name)) return `Unknown command ${name}; see oqas --help.`;
  const known = name as keyof typeof ON_SESSIONS;
  const taken: readonly string[] = ON_SESSIONS[known];
  if (opens) return `oqas ${known} acts on a session that exists: it takes no --brief nor --environment.`;
  if (rest.length !== taken.length) return `oqas ${known} takes ${taken.length === 0 ? "no word after it" : taken.join(" then ")}.`;
  if (follow && known !== "show" && known !== "attach") return `oqas ${known} prints no thread: it takes no --follow.`;
  const [session = "", text = ""] = rest;
  if (known === "sessions") return { name: known };
  return known === "say" ? { name: known, session, text } : { name: known, session };
}
