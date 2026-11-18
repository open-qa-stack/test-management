import { basename } from "node:path";
import type { OqasConfig } from "@open-qa-stack/domain";
import type { Project } from "@open-qa-stack/domain/sessions";

/**
 * Gives the project of an instance: the test repository its sessions run in, with the applications of its
 * configuration.
 *
 * @param repository - Absolute path of the test repository.
 * @param configuration - The configuration in force; `undefined` when the instance has none.
 * @returns The project, named after the folder of the repository, with the applications the configuration
 * declares; without application when there is no configuration.
 */
export function repositoryProject(repository: string, configuration: OqasConfig | undefined): Project {
  return { name: basename(repository), applications: (configuration?.applications ?? []).map(({ id, name }) => ({ id, name })) };
}
