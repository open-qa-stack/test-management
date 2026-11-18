import type { DocumentEntry, DocumentStorePort, StoredDocument, StoredDocumentSummary } from "@open-qa-stack/domain";
import { instant } from "../database/stored-values.ts";
import type { Kysely, Selectable } from "kysely";
import type { Database } from "../database/database.ts";
import type { KnowledgeDocumentsTable, StoreSchema } from "../database/schema.ts";

/** A row of the documents, as it is read. */
type DocumentRow = Selectable<KnowledgeDocumentsTable>;

/** The columns of a document but its text, which a listing leaves out. */
const SUMMARY = ["name", "bytes", "uploaded_at"] as const;

/** A row of the documents as the summary of the document it holds, its date in ISO 8601. */
function summaryOf({ name, bytes, uploaded_at }: Pick<DocumentRow, (typeof SUMMARY)[number]>): StoredDocumentSummary {
  return { name, bytes, uploadedAt: instant(uploaded_at) };
}

/** Orders documents by their names, code unit by code unit, the same on every database whatever its collation. */
function byName(left: { readonly name: string }, right: { readonly name: string }): number {
  return Number(left.name > right.name) - Number(left.name < right.name);
}

/**
 * The documents of the knowledge sources of the instance, as its database keeps them.
 *
 * @remarks
 * An upload is kept in one transaction, all of its documents or none; a document of a name its source holds
 * replaces it. What the store dates, it dates by the clock of the process that writes.
 */
export class DocumentStore implements DocumentStorePort {
  readonly #database: Kysely<StoreSchema>;
  readonly #clock: () => Date;

  /**
   * @param database - The database of the instance, with its migrations applied.
   * @param clock - What tells the date; the clock of the machine by default.
   */
  constructor(database: Database, clock: () => Date = () => new Date()) {
    this.#database = database.kysely;
    this.#clock = clock;
  }

  /** @returns The documents of a source, without their texts, in the order of their names. */
  async list(source: string): Promise<StoredDocumentSummary[]> {
    const rows = await this.#database.selectFrom("knowledge_documents").select(SUMMARY).where("source", "=", source).execute();
    return rows.map(summaryOf).sort(byName);
  }

  /** @returns The documents of a source, with their texts, in the order of their names. */
  async documents(source: string): Promise<StoredDocument[]> {
    const rows = await this.#database.selectFrom("knowledge_documents").selectAll().where("source", "=", source).execute();
    return rows.map((row) => ({ ...summaryOf(row), text: row.text })).sort(byName);
  }

  /** @returns The document of a source of that name; `undefined` when it holds none. */
  async read(source: string, name: string): Promise<StoredDocument | undefined> {
    const row = await this.#database.selectFrom("knowledge_documents").selectAll().where("source", "=", source).where("name", "=", name).executeTakeFirst();
    return row === undefined ? undefined : { ...summaryOf(row), text: row.text };
  }

  /** Keeps documents in a source, all of them or none, each replacing the one of its name. */
  async put(source: string, entries: readonly DocumentEntry[]): Promise<void> {
    const uploaded_at = instant(this.#clock());
    await this.#database.transaction().execute(async (transaction) => {
      for (const { name, text } of entries) {
        const bytes = Buffer.byteLength(text, "utf8");
        await transaction
          .insertInto("knowledge_documents")
          .values({ source, name, uploaded_at, bytes, text })
          .onConflict((conflict) => conflict.columns(["source", "name"]).doUpdateSet({ uploaded_at, bytes, text }))
          .execute();
      }
    });
  }

  /** @returns Whether the source held the document, which it holds no more. */
  async remove(source: string, name: string): Promise<boolean> {
    const removed = await this.#database.deleteFrom("knowledge_documents").where("source", "=", source).where("name", "=", name).executeTakeFirst();
    return removed.numDeletedRows > 0n;
  }
}
