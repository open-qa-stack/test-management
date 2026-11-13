import { execFile } from "node:child_process";

/** Longest output of a command a tool returns, in characters, for each of its two streams. */
export const MAX_OUTPUT_LENGTH = 20_000;

/** What a command printed, and how it ended. */
export interface ProcessResult {
  /** Exit code, or `null` when the command was stopped. */
  readonly exitCode: number | null;
  /** Its standard output, cut to `MAX_OUTPUT_LENGTH`. */
  readonly stdout: string;
  /** Its error output, cut to `MAX_OUTPUT_LENGTH`. */
  readonly stderr: string;
  /** Whether it ran out of time and was stopped. */
  readonly timedOut: boolean;
  /** Whether an output was cut; when it passed a megabyte, the command was stopped and `exitCode` is `null`. */
  readonly truncated: boolean;
}

/**
 * Runs a program without a shell, in a folder, with an environment that holds `PATH` only.
 *
 * @remarks
 * The environment of the harness, its keys and connection strings included, is not passed to the program;
 * a program that reads the parent process or the user's files can still find them. The program is stopped
 * once `timeoutMs` has passed, or once an output passes a megabyte.
 *
 * @param file - The program.
 * @param args - Its arguments, each passed as it is.
 * @param cwd - Folder it runs in.
 * @param timeoutMs - Longest it may run.
 * @param env - Variables added to `PATH`.
 * @returns What it printed and how it ended; a program that fails is a result, not an error.
 * @throws Error when the program cannot be started.
 */
export function runProcess(
  file: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
  env: Readonly<Record<string, string>> = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { cwd, env: { PATH: process.env["PATH"], ...env }, timeout: timeoutMs, maxBuffer: 1_000_000, encoding: "utf8" },
      (failure, stdout, stderr) => {
        const code = (failure as { code?: unknown } | null)?.code;
        if (typeof code === "string" && code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          reject(new Error(`${file} cannot be run: ${code}.`));
          return;
        }
        const timedOut = (failure as { killed?: boolean } | null)?.killed === true;
        const cut = (text: string) => (text.length > MAX_OUTPUT_LENGTH ? text.slice(0, MAX_OUTPUT_LENGTH) : text);
        resolve({
          exitCode: failure === null ? 0 : typeof code === "number" ? code : null,
          stdout: cut(stdout),
          stderr: cut(stderr),
          timedOut,
          truncated: stdout.length > MAX_OUTPUT_LENGTH || stderr.length > MAX_OUTPUT_LENGTH || code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        });
      },
    );
  });
}
