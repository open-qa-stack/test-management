import {
  InvalidDocumentsError,
  isStoredDocuments,
  readUpload,
  UnknownDocumentError,
  UnknownDocumentSourceError,
  type ConfigurationQueries,
  type DocumentStorePort,
  type ReceivedFile,
  type StoredDocument,
  type StoredDocumentSummary,
} from "@open-qa-stack/domain";

/**
 * The operations on the documents of the knowledge sources of an instance: list those of a source, read one, upload
 * some, remove one. Whatever shows them — a REST API, a terminal — calls these and holds no rule of its own.
 *
 * @remarks
 * A source takes documents once the revision in force of the configuration declares it `stored`: a revision declares
 * the source, and its documents are uploaded to it. The store keeps them, and only it; a run writes those of each
 * such source to its state folder when it starts, and its agents read them there.
 */
export class KnowledgeDocuments {
  readonly #store: DocumentStorePort;
  readonly #configuration: ConfigurationQueries;

  /**
   * @param store - The store of the documents.
   * @param configuration - What tells the revision in force of the configuration, which declares the sources.
   */
  constructor(store: DocumentStorePort, configuration: ConfigurationQueries) {
    this.#store = store;
    this.#configuration = configuration;
  }

  /**
   * @param source - The identifier of the source.
   * @returns Its documents, without their texts, in the order of their names.
   * @throws `UnknownDocumentSourceError` when the revision in force declares no such source of stored documents.
   */
  async list(source: string): Promise<StoredDocumentSummary[]> {
    await this.#declared(source);
    return this.#store.list(source);
  }

  /**
   * @param source - The identifier of the source.
   * @param name - The file name of the document.
   * @returns The document, with its text.
   * @throws `UnknownDocumentSourceError` when the revision in force declares no such source of stored documents.
   * @throws `UnknownDocumentError` when the source holds no document of that name.
   */
  async read(source: string, name: string): Promise<StoredDocument> {
    await this.#declared(source);
    const document = await this.#store.read(source, name);
    if (document === undefined) throw new UnknownDocumentError(source, name);
    return document;
  }

  /**
   * Uploads documents to a source, all of them or none: a document of a name the source holds replaces it.
   *
   * @param source - The identifier of the source.
   * @param files - The files of the upload, in its order, each with what was received of its content.
   * @throws `UnknownDocumentSourceError` when the revision in force declares no such source of stored documents.
   * @throws `InvalidDocumentsError` when the upload breaks a rule of the documents: nothing is kept.
   */
  async upload(source: string, files: readonly ReceivedFile[]): Promise<void> {
    await this.#declared(source);
    const read = readUpload(files);
    if (!read.ok) throw new InvalidDocumentsError(read.errors);
    await this.#store.put(source, read.entries);
  }

  /**
   * Removes a document of a source.
   *
   * @param source - The identifier of the source.
   * @param name - The file name of the document.
   * @throws `UnknownDocumentSourceError` when the revision in force declares no such source of stored documents.
   * @throws `UnknownDocumentError` when the source holds no document of that name.
   */
  async remove(source: string, name: string): Promise<void> {
    await this.#declared(source);
    if (!(await this.#store.remove(source, name))) throw new UnknownDocumentError(source, name);
  }

  /** Refuses a source the revision in force does not declare as one whose documents the instance keeps. */
  async #declared(source: string): Promise<void> {
    const knowledge = (await this.#configuration.inForce())?.document.knowledge ?? [];
    if (!knowledge.some((declared) => declared.id === source && isStoredDocuments(declared))) throw new UnknownDocumentSourceError(source);
  }
}
