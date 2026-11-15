import { resolve } from "node:path";
import type { CommandRunner } from "@open-qa-stack/domain";
import type { ResolvedConfig } from "@open-qa-stack/shared";
import type { TraceLine } from "@open-qa-stack/agents";
import { parseArguments, USAGE } from "./arguments.ts";
import { followedLine } from "./followed-line.ts";
import { ExitCode, type ExitCodeValue } from "./exit-code.ts";
import { liveRuntime, type OpenRuntime } from "./live-runtime.ts";
import { playwrightVersion } from "@open-qa-stack/tools";
import { RepositoryInit } from "./repository-init.ts";
import { SoloRun } from "./solo-run.ts";

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
}

/**
 * Runs `oqas` with its arguments: prints the usage, refuses a wrong option, initialises the test repository, or
 * runs the solo command.
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
  if (init)
    return new RepositoryInit({
      repositoryRoot: resolve(io.cwd, repository ?? "."),
      playwrightVersion: playwrightVersion(),
      write: (line) => io.stderr.write(line),
      print: (line) => io.stdout.write(line),
    }).run();
  const connect = io.connect ?? liveRuntime;
  const run = new SoloRun({
    repositoryRoot: resolve(io.cwd, repository ?? "."),
    ...(environment === undefined ? {} : { environment }),
    ...(brief === undefined ? {} : { brief }),
    ...(resume === undefined ? {} : { resume }),
    force,
    env: io.env,
    write: (line) => io.stderr.write(line),
    ...(follow ? { follow: (line: TraceLine) => followed(line, io.stderr) } : {}),
    print: (line) => io.stdout.write(line),
    openRuntime: (config) => connect(config, io.env),
    ...(io.runner === undefined ? {} : { runner: io.runner }),
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
