import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import SqliteFile from "better-sqlite3";
import { DatabaseUnavailableError } from "../database-unavailable-error.ts";
import type { SqliteDatabase } from "kysely";

/** The name SQLite gives a database it keeps in memory. */
const IN_MEMORY = ":memory:";

/**
 * How long a statement waits for another process that writes to the file before it fails, in milliseconds: a
 * write of the store takes milliseconds, and a terminal and a server may write to the same file.
 */
const BUSY_TIMEOUT_MS = 5000;

/**
 * Opens the file of a SQLite database, in a folder made for it when it is missing.
 *
 * @remarks
 * The file is kept with a write-ahead log, so that whoever reads it — another process of the instance, a
 * backup, a shell — never stops a process from writing. One process writes at a time: another that writes
 * meanwhile waits for it, up to {@link BUSY_TIMEOUT_MS}.
 *
 * @param file - The path of the file, or `:memory:` for a database kept in memory.
 * @returns The database, open, as the query builder takes one.
 * @throws {@link DatabaseUnavailableError} when the file cannot be opened, which names it.
 */
export function openSqliteFile(file: string): SqliteDatabase {
  try {
    if (file !== IN_MEMORY) mkdirSync(dirname(file), { recursive: true });
    const database = new SqliteFile(file, { timeout: BUSY_TIMEOUT_MS });
    database.pragma("journal_mode = WAL");
    return database;
  } catch (error) {
    throw new DatabaseUnavailableError(`${file} cannot be opened (${(error as Error).message}).`);
  }
}
