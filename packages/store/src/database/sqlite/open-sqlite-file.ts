import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import SqliteFile from "better-sqlite3";
import { DatabaseUnavailableError } from "../database-unavailable-error.ts";
import type { SqliteDatabase } from "kysely";

/** The name SQLite gives a database it keeps in memory. */
const IN_MEMORY = ":memory:";

/**
 * Opens the file of a SQLite database, in a folder made for it when it is missing.
 *
 * @remarks
 * The file is kept with a write-ahead log, so that whoever reads it from outside, a backup or a shell, never
 * stops the instance from writing.
 *
 * @param file - The path of the file, or `:memory:` for a database kept in memory.
 * @returns The database, open, as the query builder takes one.
 * @throws {@link DatabaseUnavailableError} when the file cannot be opened, which names it.
 */
export function openSqliteFile(file: string): SqliteDatabase {
  try {
    if (file !== IN_MEMORY) mkdirSync(dirname(file), { recursive: true });
    const database = new SqliteFile(file);
    database.pragma("journal_mode = WAL");
    return database;
  } catch (error) {
    throw new DatabaseUnavailableError(`${file} cannot be opened (${(error as Error).message}).`);
  }
}
