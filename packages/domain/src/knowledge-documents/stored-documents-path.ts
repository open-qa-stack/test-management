import type { Knowledge, OqasConfig, StoredDocumentKnowledge } from "../config/types.ts";

/** The folder of the state folder of a test repository a run writes the documents an instance keeps to, one folder a source. */
export const STORED_DOCUMENTS_FOLDER = "documents";

/**
 * Tells whether a knowledge source holds documents the instance keeps.
 *
 * @param source - A knowledge source of the configuration.
 * @returns Whether it is a source of documents declared `stored`.
 */
export function isStoredDocuments(source: Knowledge): source is StoredDocumentKnowledge {
  return source.type === "document" && source.stored === true;
}

/**
 * Names the folder a run writes the documents of a source the instance keeps to, where its tools read them.
 *
 * @param stateDir - The state folder of the test repository, relative to its root.
 * @param source - The identifier of the source.
 * @returns The folder, relative to the root of the test repository, with `/`.
 */
export function storedDocumentsPath(stateDir: string, source: string): string {
  return `${stateDir}/${STORED_DOCUMENTS_FOLDER}/${source}`;
}

/**
 * Lists the sources of a configuration whose documents the instance keeps.
 *
 * @param config - The configuration.
 * @returns Their identifiers, in the order of the configuration.
 */
export function storedDocumentSources(config: Pick<OqasConfig, "knowledge">): string[] {
  return config.knowledge.filter(isStoredDocuments).map((source) => source.id);
}
