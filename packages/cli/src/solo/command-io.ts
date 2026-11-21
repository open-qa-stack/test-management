import type { CommandRunner, ResolvedConfig } from "@open-qa-stack/domain";
import type { ConnectionProbes, OpenRuntime, SessionsPace } from "@open-qa-stack/engine";

/** Where a command writes: an output of the process. */
export interface CommandOutput {
  write(text: string): unknown;
}

/** The terminal a person sits at: where the command reads their keys and draws its screen. */
export interface CommandTerminal {
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
}

/** What the command runs with: its environment, its folder and its outputs. */
export interface CommandIo {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The folder the command runs in: the test repository by default. */
  readonly cwd: string;
  readonly stdout: CommandOutput;
  readonly stderr: CommandOutput;
  /** The terminal of the person, when the command has one on both its input and its output: without it, the command asks nothing and draws nothing. */
  readonly terminal?: CommandTerminal;
  /**
   * Listens to the person who asks the command to stop, Ctrl-C in a terminal: the listener is called each
   * time they do.
   *
   * @returns What stops listening. Nobody is listened to without it.
   */
  readonly onInterrupt?: (listener: () => void) => () => void;
  /** Runs the commands of the machine and of the tests; a `LocalRunner` in the test repository by default. */
  readonly runner?: CommandRunner;
  /** Opens the runtime of the agents; `liveRuntime` by default. */
  readonly connect?: (config: ResolvedConfig, env: Readonly<Record<string, string | undefined>>) => Promise<OpenRuntime>;
  /** The clock of the runs; the system clock by default. */
  readonly now?: () => Date;
  /** The folder of the built console `oqas --ui` serves; that of the workspace by default. */
  readonly console?: string;
  /** The paces of the command among the processes that reach the same database; those of the engine by default. */
  readonly pace?: SessionsPace;
  /** How the connection to the model is tested; with the GitHub account of the machine and the server of the provider by default. */
  readonly probes?: ConnectionProbes;
}
