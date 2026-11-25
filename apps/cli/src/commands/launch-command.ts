import { setTimeout as pause } from "node:timers/promises";
import { ExitCode, type ExitCodeValue, type TestLaunch } from "@open-qa-stack/domain";
import type { Command } from "../arguments/command.ts";
import { executionLines } from "../output/test-lines.ts";
import { LaunchEndError } from "../sessions/launch-end-error.ts";
import type { Asked } from "./asked.ts";
import type { Operations } from "./operations.ts";
import { print } from "./print.ts";

/** How often a launch that runs is asked how far it went, in milliseconds. */
const LAUNCH_BEAT_MS = 100;

/**
 * `oqas launch`: launches tests of the test repository as they are, with no agent, in this process, and follows them
 * to their end.
 */
export async function launched(
  operations: Pick<Operations, "sessions" | "executions">,
  command: Extract<Command, { name: "launch" }>,
  printing: Pick<Asked<"launch">, "options" | "io">,
): Promise<ExitCodeValue> {
  const { paths, environment } = command;
  const launch = await operations.sessions.launch({ ...(paths.length === 0 ? {} : { paths }), ...(environment === undefined ? {} : { environment }) });
  return followed(operations, launch, printing);
}

/**
 * Follows a launch of tests that runs in this process to its end: each test it finished on the error output, then the
 * execution it kept. Exits with `0` when each test passed, `1` when one failed, `2` when one was skipped, `5` when it
 * kept no execution.
 */
export async function followed(
  { sessions, executions }: Pick<Operations, "sessions" | "executions">,
  launch: TestLaunch,
  printing: Pick<Asked<"launch">, "options" | "io">,
): Promise<ExitCodeValue> {
  const { stderr } = printing.io;
  const { paths } = launch;
  stderr.write(`Tests launched against ${launch.environment}: ${paths.length === 0 ? "every test of the repository" : paths.join(", ")}.\n`);
  let told = 0;
  let state = await sessions.launches();
  // The launch is the one that runs until it is the last that ended: the next one waits for it.
  while (state.last?.startedAt !== launch.startedAt) {
    const finished = state.running?.progress?.finished ?? [];
    for (const { verdict, path, title } of finished.slice(told)) stderr.write(`${verdict.padEnd(7)} ${path} › ${title}\n`);
    told = Math.max(told, finished.length);
    await pause(LAUNCH_BEAT_MS);
    state = await sessions.launches();
  }
  const { execution: id, failure } = state.last;
  if (id === undefined) throw new LaunchEndError(failure);
  const execution = await executions.get(id);
  print(printing, executionLines(execution).join("\n"), execution);
  const verdicts = new Set(execution.results.map(({ verdict }) => verdict));
  if (verdicts.has("failed")) return ExitCode.failed;
  return verdicts.has("skipped") ? ExitCode.unsettled : ExitCode.passed;
}
