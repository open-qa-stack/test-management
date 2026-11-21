import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CommandRunner, ResolvedConfig } from "@open-qa-stack/domain";
import { checkProviderModels } from "@open-qa-stack/harness";

/**
 * What the machine lacks for a run: the root of a git repository with a commit, a model server
 * that answers and takes the key, npm, and a test repository initialised as a Playwright project. A model
 * of GitHub Copilot has no server of its own to ask: its connection is told by the session that calls it.
 *
 * @param config - The resolved configuration.
 * @param repositoryRoot - Absolute path of the test repository.
 * @param runner - Runs the commands of the machine, such as `npm --version`.
 * @param env - The environment the key of the model is read from.
 * @returns A sentence for each missing prerequisite, which names it; none when nothing is missing.
 */
export async function missingPrerequisites(
  config: ResolvedConfig,
  repositoryRoot: string,
  runner: CommandRunner,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string[]> {
  const [repository, model, npm, project] = await Promise.all([
    gitRoot(repositoryRoot),
    modelProblem(config, env),
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
    ...(model === undefined ? [] : [model]),
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

/** What keeps the model server from serving a run: it does not answer, or refuses the key; `undefined` when it serves. */
async function modelProblem(config: ResolvedConfig, env: Readonly<Record<string, string | undefined>>): Promise<string | undefined> {
  const { model } = config;
  if (model.mode === "github") return undefined;
  const check = await checkProviderModels(model.baseUrl, model.apiKeyEnv === undefined ? undefined : env[model.apiKeyEnv]);
  const server = `The model server at ${model.baseUrl}`;
  if (check.state === "unreachable") return `${server} does not answer.`;
  if (check.state !== "key-refused") return undefined;
  if (model.apiKeyEnv === undefined) return `${server} asks for a key, with status ${check.status}: name the variable that holds it with oqas model set.`;
  return `${server} refused the key in ${model.apiKeyEnv}, with status ${check.status}: check the key; oqas model status tests it.`;
}
