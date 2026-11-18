import type { DocumentEntry, DocumentStorePort, StoredDocument, StoredDocumentSummary } from "@open-qa-stack/domain";

/** The store of the documents of the knowledge sources kept in memory, by the rule of the port: what the operations and the runs are tested on, without a database. */
export class MemoryDocumentStore implements DocumentStorePort {
  readonly #sources = new Map<string, Map<string, StoredDocument>>();
  readonly #clock: () => Date;

  /** @param clock - What tells the date of an upload. */
  constructor(clock: () => Date = () => new Date("2026-11-18T09:00:00.000Z")) {
    this.#clock = clock;
  }

  list(source: string): Promise<StoredDocumentSummary[]> {
    return Promise.resolve(this.#of(source).map(({ text: _, ...summary }) => summary));
  }

  documents(source: string): Promise<StoredDocument[]> {
    return Promise.resolve(this.#of(source));
  }

  read(source: string, name: string): Promise<StoredDocument | undefined> {
    return Promise.resolve(this.#sources.get(source)?.get(name));
  }

  put(source: string, entries: readonly DocumentEntry[]): Promise<void> {
    const documents = this.#sources.get(source) ?? new Map<string, StoredDocument>();
    const uploadedAt = this.#clock().toISOString();
    for (const { name, text } of entries) documents.set(name, { name, text, bytes: Buffer.byteLength(text, "utf8"), uploadedAt });
    this.#sources.set(source, documents);
    return Promise.resolve();
  }

  remove(source: string, name: string): Promise<boolean> {
    return Promise.resolve(this.#sources.get(source)?.delete(name) ?? false);
  }

  /** The documents of a source, in the order of their names. */
  #of(source: string): StoredDocument[] {
    return [...(this.#sources.get(source)?.values() ?? [])].sort((left, right) => Number(left.name > right.name) - Number(left.name < right.name));
  }
}
