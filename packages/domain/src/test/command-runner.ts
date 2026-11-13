/** How a command ended. */
export interface CommandOutcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A command of a step of a run, in the folder of the test repository. */
export interface StepCommand {
  /** The program and its arguments, run without a shell; paths are relative to the test repository. */
  readonly command: readonly string[];
  /** Variables added to the command's environment. */
  readonly env?: Readonly<Record<string, string>>;
  /** Longest run, in milliseconds; the command is stopped past it. */
  readonly timeoutMs: number;
}

/** What executes the commands of the steps of a run. */
export interface CommandRunner {
  /**
   * Runs the command of a step.
   *
   * @param step - The command.
   * @returns How it ended.
   * @throws Error when the command cannot be called.
   */
  run(step: StepCommand): Promise<CommandOutcome>;
}
