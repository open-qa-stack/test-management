import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isReadIn, resolvedConfig, type OqasConfig } from "@open-qa-stack/domain";

/**
 * Marks the knowledge of a test repository mapped: a card for each source the cartography reads in the first
 * environment — the knowledge sources but logs, the interface of each application — and a knowledge base, none of them valid,
 * so that a host that maps the knowledge finds nothing waiting, and a run maps it all again as before.
 *
 * @param root - The test repository, which holds its configuration file.
 */
export function markMapped(root: string): void {
  const config = resolvedConfig(JSON.parse(readFileSync(join(root, "oqas.json"), "utf8")) as OqasConfig);
  const environment = config.applications[0]!.environments[0]!.name;
  const knowledge = config.knowledge.filter((source) => source.type !== "logs" && isReadIn(source, environment)).map(({ id }) => id);
  const interfaces = config.applications
    .filter((application) => application.environments.some((e) => e.name === environment && e.uiUrl !== undefined))
    .map(({ id }) => id);
  const folder = join(root, config.repository.knowledgeDir);
  mkdirSync(join(folder, "sources"), { recursive: true });
  for (const id of [...knowledge, ...interfaces]) writeFileSync(join(folder, "sources", `${id}.json`), "{}");
  writeFileSync(join(folder, "knowledge-base.json"), "{}");
}
