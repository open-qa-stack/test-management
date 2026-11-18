import { Database } from "./database.ts";
import { MIGRATIONS } from "./migrations/index.ts";
import { SchemaMigrations } from "./schema-migrations.ts";
import type { Migration } from "kysely/migration";
import type { StoreLogger } from "../store-logger.ts";
import type { DatabaseUrl } from "./database-url.ts";

/**
 * Applies to a database every versioned migration it has not applied yet, on a connection of its own, which
 * it closes: this is the whole of a migration command.
 *
 * @param url - The connection URL of the database.
 * @param logger - Where a connection that drops is reported.
 * @param migrations - The migrations, each under its name; those of the package by default.
 * @returns What was done, in one sentence.
 * @throws {@link DatabaseUnavailableError} when the database cannot be reached.
 */
export async function runMigrations(url: DatabaseUrl, logger: StoreLogger, migrations: Readonly<Record<string, Migration>> = MIGRATIONS): Promise<string> {
  const database = new Database(url, logger);
  try {
    const applied = await new SchemaMigrations(database, migrations).apply();
    if (applied === 0) return "The database schema is up to date: no migration to apply.";
    return `Applied ${applied} ${applied === 1 ? "migration" : "migrations"}.`;
  } finally {
    await database.close();
  }
}
