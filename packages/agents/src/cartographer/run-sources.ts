import { isReadIn, type IndexSourceType, type Knowledge, type MappedKnowledge, type ResolvedConfig } from "@open-qa-stack/domain";

/** A source the cartographer reads: a knowledge source, or the user interface of an application. */
export type RunSource =
  | { readonly id: string; readonly type: Exclude<IndexSourceType, "web">; readonly knowledge: MappedKnowledge }
  | { readonly id: string; readonly type: "web"; readonly uiUrl: string };

/**
 * Lists the sources of a run: the knowledge sources attached to the environment, or to no environment,
 * then the user interface of each application that has one in the environment. Logs are left out: they
 * tell what a service did, not what an application holds.
 *
 * @param config - The resolved configuration.
 * @param environment - Name of the environment explored.
 * @returns The sources, knowledge first, each under its identifier in the configuration.
 */
export function runSources(config: ResolvedConfig, environment: string): RunSource[] {
  const knowledge = config.knowledge
    .filter(isMapped)
    .filter((source) => isReadIn(source, environment))
    .map((source): RunSource => ({ id: source.id, type: source.type, knowledge: source }));
  const interfaces = config.applications.flatMap((application): RunSource[] => {
    const uiUrl = application.environments.find((e) => e.name === environment)?.uiUrl;
    return uiUrl === undefined ? [] : [{ id: application.id, type: "web", uiUrl }];
  });
  return [...knowledge, ...interfaces];
}

function isMapped(source: Knowledge): source is MappedKnowledge {
  return source.type !== "logs";
}
