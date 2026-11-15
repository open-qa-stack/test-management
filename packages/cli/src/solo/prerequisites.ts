import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CommandRunner } from "@open-qa-stack/domain";
import type { ResolvedConfig } from "@open-qa-stack/shared";

/** Longest wait for the model server to answer, in milliseconds. */
export const MODEL_TIMEOUT_MS = 5000;

/**
 * What the machine lacks to run the solo command: the root of a git repository with a commit, a model server
 * that answers, npm, and a test repository initialised as a Playwright project.
 *
 * @param config - The resolved configuration.
 * @param repositoryRoot - Absolute path of the test repository.
 * @param runner - Runs the commands of the machine, such as `npm --version`.
 * @returns A sentence for each missing prerequisite, which names it; none when nothing is missing.
 */
export async function missingPrerequisites(config: ResolvedConfig, repositoryRoot: string, runner: CommandRunner): Promise<string[]> {
  const [repository, model, npm, project] = await Promise.all([
    gitRoot(repositoryRoot),
    answers(new URL("models", `${config.model.baseUrl.replace(/\/+$/, "")}/`).href),
    runner.run({ command: ["npm", "--version"], timeoutMs: 30_000 }).then(
      (outcome) => outcome.exitCode === 0,
      () => false,
    ),
    stat(join(repositoryRoot, "playwright.config.ts")).then(
      () => true,
      () => false,
    ),
  ]);
  return [
    ...(repository ? [] : [`${repositoryRoot} is not the root of a git repository with a commit; the tests are written on a branch of the test repository.`]),
    ...(model ? [] : [`The model server at ${config.model.baseUrl} does not answer.`]),
    ...(npm ? [] : ["npm cannot be run; it installs the dependencies of the test repository."]),
    ...(project
      ? []
      : [
          `${repositoryRoot} has no playwright.config.ts: it is not a Playwright project yet. Run oqas --init in it, then npm install, and commit what was written.`,
        ]),
  ];
}

/** Whether a folder is the root of a git repository with a commit, as the designer needs it. */
async function gitRoot(folder: string): Promise<boolean> {
  const top = await new Promise<string | undefined>((resolve) =>
    execFile("git", ["rev-parse", "--show-toplevel", "--verify", "HEAD"], { cwd: folder }, (error, stdout) =>
      resolve(error === null ? stdout.split("\n")[0] : undefined),
    ),
  );
  return top !== undefined && (await realpath(top)) === (await realpath(folder));
}

/** Whether an address gives any HTTP response within the time limit. */
function answers(url: string): Promise<boolean> {
  return fetch(url, { signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) }).then(
    () => true,
    () => false,
  );
}
