import type { DocumentEntry, StoredDocument, StoredDocumentSummary } from "./stored-document.ts";

/**
 * The port of the store of the documents of the knowledge sources: what the operations on documents and the runs
 * ask of what keeps them, whatever keeps them. A document is named by its source and its file name.
 */
export interface DocumentStorePort {
  /**
   * @param source - The identifier of the source.
   * @returns Its documents, without their texts, in the order of their names.
   */
  list(source: string): Promise<StoredDocumentSummary[]>;

  /**
   * @param source - The identifier of the source.
   * @returns Its documents, with their texts, in the order of their names.
   */
  documents(source: string): Promise<StoredDocument[]>;

  /**
   * @param source - The identifier of the source.
   * @param name - The file name of the document.
   * @returns The document; `undefined` when the source holds none of that name.
   */
  read(source: string, name: string): Promise<StoredDocument | undefined>;

  /**
   * Keeps documents in a source, all of them or none: a document of a name the source holds replaces it.
   *
   * @param source - The identifier of the source.
   * @param entries - The documents, each name once.
   */
  put(source: string, entries: readonly DocumentEntry[]): Promise<void>;

  /**
   * Removes a document of a source.
   *
   * @param source - The identifier of the source.
   * @param name - The file name of the document.
   * @returns Whether the source held it.
   */
  remove(source: string, name: string): Promise<boolean>;
}
