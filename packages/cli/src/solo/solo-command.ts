import { join, resolve } from "node:path";
import { PersonInbox } from "@open-qa-stack/agents";
import { ExitCode, runInboxFile, RUNS_FOLDER, type CommandRunner, type ExitCodeValue, type ResolvedConfig, type TraceLine } from "@open-qa-stack/domain";
import { liveRuntime, Run, type OpenRuntime } from "@open-qa-stack/engine";
import { playwrightVersion } from "@open-qa-stack/tools";
import { parseArguments, USAGE } from "./arguments.ts";
import { FileJournal } from "./file-journal.ts";
import { FileRunStore } from "./file-run-store.ts";
import { followedLine } from "./followed-line.ts";
import { RepositoryInit } from "./repository-init.ts";

/** What the command runs with: its environment, its folder and its outputs. */
export interface CommandIo {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The folder the command runs in: the test repository by default. */
  readonly cwd: string;
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
  /** Runs the commands of the machine and of the tests; a `LocalRunner` in the test repository by default. */
  readonly runner?: CommandRunner;
  /** Opens the runtime of the agents; `liveRuntime` by default. */
  readonly connect?: (config: ResolvedConfig, env: Readonly<Record<string, string | undefined>>) => Promise<OpenRuntime>;
  /** The clock; the system clock by default. */
  readonly now?: () => Date;
}

/**
 * Runs `oqas` with its arguments: prints the usage, refuses a wrong option, initialises the test repository, or
 * runs the solo command.
 *
 * @remarks
 * A run is a run of the engine, which the command plugs into the terminal and the test repository: the
 * journal goes to the error output and to a file of the run, the summary to the standard output, the inbox
 * is a file a person appends to, and the state of each run is a file beside its journal.
 *
 * @param argv - The arguments, without the program.
 * @param io - The environment, the folder and the outputs.
 * @returns The exit code; `5` when the run stopped on an unexpected error, which goes to the error output.
 */
export async function soloCommand(argv: readonly string[], io: CommandIo): Promise<ExitCodeValue> {
  const parsed = parseArguments(argv);
  if (!parsed.ok) {
    io.stderr.write(`${parsed.error}\n`);
    return ExitCode.configuration;
  }
  const { repository, environment, brief, force, follow, help, init, resume } = parsed.arguments;
  if (help) {
    io.stdout.write(USAGE);
    return ExitCode.passed;
  }
  const repositoryRoot = resolve(io.cwd, repository ?? ".");
  if (init)
    return new RepositoryInit({
      repositoryRoot,
      playwrightVersion: playwrightVersion(),
      write: (line) => io.stderr.write(line),
      print: (line) => io.stdout.write(line),
    }).run();
  const connect = io.connect ?? liveRuntime;
  const run = new Run({
    repositoryRoot,
    ...(environment === undefined ? {} : { environment }),
    ...(brief === undefined ? {} : { brief }),
    ...(resume === undefined ? {} : { resume }),
    force,
    env: io.env,
    journal: new FileJournal(repositoryRoot, (line) => io.stderr.write(line)),
    ...(follow ? { follow: (line: TraceLine) => followed(line, io.stderr) } : {}),
    print: (line) => io.stdout.write(line),
    openInbox: ({ runId, stateDir }) => new PersonInbox(join(repositoryRoot, stateDir, RUNS_FOLDER, runInboxFile(runId))),
    store: new FileRunStore(repositoryRoot),
    openRuntime: (config) => connect(config, io.env),
    ...(io.runner === undefined ? {} : { runner: io.runner }),
    ...(io.now === undefined ? {} : { now: io.now }),
  });
  try {
    return await run.run();
  } catch (error) {
    io.stderr.write(`oqas stopped on an unexpected error: ${error instanceof Error ? error.message : String(error)}\n`);
    return ExitCode.interrupted;
  }
}

/** Prints a line of the trace as a person follows it, when it says something to follow. */
function followed(line: TraceLine, output: CommandIo["stderr"]): void {
  const text = followedLine(line);
  if (text !== undefined) output.write(`${text}\n`);
}
