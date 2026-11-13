import { execFile } from "node:child_process";
import type { CommandOutcome, CommandRunner, StepCommand } from "@open-qa-stack/domain";

/** Largest output kept from a command, in bytes. */
const MAX_OUTPUT = 64 * 1024 * 1024;

/** The variables of the process npm, the runner and the browsers need; any other is left out. */
const KEPT =
  /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|LANG|LC_[A-Z]+|TZ|TERM|CI|PLAYWRIGHT_[A-Z_]+|npm_config_[a-z_]+|NODE_EXTRA_CA_CERTS|HTTPS?_PROXY|NO_PROXY|https?_proxy|no_proxy|XDG_[A-Z_]+|SYSTEMROOT|COMSPEC|PATHEXT|APPDATA|LOCALAPPDATA|USERPROFILE)$/;

/**
 * Runs the steps of a run directly on the machine, in the folder of the test repository.
 *
 * @remarks
 * Each command runs without a shell, with the variables of the process npm, the runner and the browsers
 * need, and those of the step, and is stopped past its time limit. No other variable of the process, such
 * as the key of a model or a connection string, reaches the tests.
 */
export class LocalRunner implements CommandRunner {
  private readonly root: string;

  /** @param root - Absolute path of the test repository. */
  public constructor(root: string) {
    this.root = root;
  }

  /** {@inheritDoc @open-qa-stack/domain#CommandRunner.run} */
  public run(step: StepCommand): Promise<CommandOutcome> {
    const [program, ...args] = step.command;
    return new Promise((resolve, reject) => {
      execFile(
        program!,
        args,
        {
          cwd: this.root,
          env: { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => KEPT.test(name))), ...step.env },
          timeout: step.timeoutMs,
          maxBuffer: MAX_OUTPUT,
          encoding: "utf8",
        },
        (error, stdout, stderr) => {
          if (error !== null && typeof error.code !== "number" && error.killed !== true)
            return reject(new Error(`${program} cannot be called: ${error.message}`));
          resolve({ exitCode: error === null ? 0 : typeof error.code === "number" ? error.code : 124, stdout, stderr });
        },
      );
    });
  }
}
