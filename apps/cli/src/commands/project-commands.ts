import { ExitCode, type ExitCodeValue, type RepositoryState } from "@open-qa-stack/domain";
import type { Project } from "@open-qa-stack/domain/sessions";
import type { Asked } from "./asked.ts";
import { print } from "./print.ts";

/** `oqas project`: names the project of the instance, as a host on the test repository names it, and its applications. */
export function projected(project: Project, printing: Pick<Asked<"project">, "options" | "io">): ExitCodeValue {
  print(printing, [`The project ${project.name}.`, ...project.applications.map(({ id, name }) => `  ${name} (${id})`)].join("\n"), project);
  return ExitCode.passed;
}

/** How a test repository stands to git, in the words of the command. */
const GIT_STATES: Readonly<Record<RepositoryState["git"], string>> = {
  none: "it is no git repository",
  empty: "it is a git repository without a commit",
  ready: "it is a git repository with a commit",
};

/** `oqas repository`: tells where the test repository stands. */
export function stood(state: RepositoryState, printing: Pick<Asked<"repository">, "options" | "io">): ExitCodeValue {
  const playwright = state.playwright ? "a Playwright project" : "no Playwright project yet: oqas --init prepares it";
  print(printing, `The test repository is ${state.folder}: ${GIT_STATES[state.git]}, and ${playwright}.`, state);
  return ExitCode.passed;
}
