import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * Creates the table of the documents of the knowledge sources the instance keeps, each under its source and its
 * file name: its text, its size and the date it was uploaded.
 */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable("knowledge_documents")
    .addColumn("source", "text", (column) => column.notNull())
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("uploaded_at", "timestamptz(3)", (column) => column.notNull())
    .addColumn("bytes", "integer", (column) => column.notNull())
    .addColumn("text", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("knowledge_documents_pkey", ["source", "name"])
    .execute();
}

/** The fourth migration: the documents uploaded to the knowledge sources of an instance, kept in its database. */
export const knowledgeDocuments: Migration = { up };
