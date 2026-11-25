import { ExitCode, type ExitCodeValue } from "@open-qa-stack/domain";
import { failureOf } from "../errors/failure.ts";
import type { CommandOutput } from "./command-io.ts";

/**
 * Runs something a command asks, and tells what it raised as the command does: on the error output, with the code of
 * a refusal or of a failure.
 *
 * @param run - What the command does.
 * @param stderr - Where what it raised is told.
 * @returns The code it exits with: its own, `3` when it was refused, `5` when it failed.
 */
export async function caught(run: () => Promise<ExitCodeValue>, stderr: CommandOutput): Promise<ExitCodeValue> {
  try {
    return await run();
  } catch (error) {
    const { kind, message } = failureOf(error);
    stderr.write(kind === "unexpected" ? `oqas stopped on an unexpected error: ${message}\n` : `${message}\n`);
    return kind === "refused" ? ExitCode.configuration : ExitCode.interrupted;
  }
}
