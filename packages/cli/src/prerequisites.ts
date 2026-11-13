import { execFile } from "node:child_process";
import type { CommandRunner } from "@open-qa-stack/domain";
import type { ResolvedConfig } from "@open-qa-stack/shared";

/** Longest wait for the model server to answer, in milliseconds. */
export const MODEL_TIMEOUT_MS = 5000;

/**
 * What the machine lacks to run the solo command: a git repository, a model server that answers, and npm.
 *
 * @param config - The resolved configuration.
 * @param repositoryRoot - Absolute path of the test repository.
 * @param runner - Runs the commands of the machine, such as `npm --version`.
 * @returns A sentence for each missing prerequisite, which names it; none when nothing is missing.
 */
export async function missingPrerequisites(config: ResolvedConfig, repositoryRoot: string, runner: CommandRunner): Promise<string[]> {
  const [repository, model, npm] = await Promise.all([
    gitRoot(repositoryRoot),
    answers(new URL("models", `${config.model.baseUrl.replace(/\/+$/, "")}/`).href),
    runner.run({ command: ["npm", "--version"], timeoutMs: 30_000 }).then(
      (outcome) => outcome.exitCode === 0,
      () => false,
    ),
  ]);
  return [
    ...(repository ? [] : [`${repositoryRoot} is not a git repository; the tests are written on a branch of the test repository.`]),
    ...(model ? [] : [`The model server at ${config.model.baseUrl} does not answer.`]),
    ...(npm ? [] : ["npm cannot be run; it installs the dependencies of the test repository."]),
  ];
}

/** Whether a folder is inside a git work tree. */
function gitRoot(folder: string): Promise<boolean> {
  return new Promise((resolve) => execFile("git", ["rev-parse", "--is-inside-work-tree"], { cwd: folder }, (error, stdout) => resolve(error === null && stdout.trim() === "true")));
}

/** Whether an address gives any HTTP response within the time limit. */
function answers(url: string): Promise<boolean> {
  return fetch(url, { signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) }).then(
    () => true,
    () => false,
  );
}
