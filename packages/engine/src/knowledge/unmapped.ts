import { access } from "node:fs/promises";
import { join } from "node:path";
import { CARDS_FOLDER, KNOWLEDGE_BASE_FILE_NAME, runSources } from "@open-qa-stack/agents";
import type { ResolvedConfig } from "@open-qa-stack/domain";

/** @returns Whether a file is there. */
function isThere(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/**
 * Tells whether the knowledge waits to be mapped: a source the cartography reads — a knowledge source, the interface of
 * an application — has no card yet in the test repository, or no knowledge base puts the cards together. A card or a knowledge base that
 * is there is kept as it is: whether it is up to date is the cartography's to tell.
 *
 * @param config - The configuration in force.
 * @param repository - Absolute path of the test repository.
 * @returns The environment to map, the first the configuration declares; `undefined` when nothing waits, or nothing is to map.
 */
export async function unmappedEnvironment(config: ResolvedConfig, repository: string): Promise<string | undefined> {
  // The schema asks each application for an environment, and the configuration for an application.
  const environment = config.applications[0]!.environments[0]!.name;
  const sources = runSources(config, environment);
  if (sources.length === 0) return undefined;
  const folder = join(repository, config.repository.knowledgeDir);
  const files = [...sources.map(({ id }) => join(folder, CARDS_FOLDER, `${id}.json`)), join(folder, KNOWLEDGE_BASE_FILE_NAME)];
  return (await Promise.all(files.map(isThere))).every(Boolean) ? undefined : environment;
}
