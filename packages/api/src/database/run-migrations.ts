import { DATABASE_VARIABLES } from "../config/api-variables.ts";
import type { Environment } from "../config/environment-variable.ts";
import { readVariables } from "../config/read-variables.ts";
import { Database } from "./database.ts";
import { SchemaMigrations } from "./schema-migrations.ts";

/**
 * Applies to the configured database every versioned migration it has not applied yet.
 *
 * @param env - The environment the connection URL is read from.
 * @param folder - The folder of the migrations.
 * @returns What was done, in one sentence.
 * @throws {@link ConfigurationError} when the connection URL is missing or invalid.
 * @throws {@link DatabaseUnavailableError} when the database cannot be reached.
 */
export async function runMigrations(env: Environment, folder: string): Promise<string> {
  const { database: url } = readVariables(DATABASE_VARIABLES, env);
  const database = new Database(url);
  try {
    const applied = await new SchemaMigrations(database, folder).apply();
    if (applied === 0) return "The database schema is up to date: no migration to apply.";
    return `Applied ${applied} ${applied === 1 ? "migration" : "migrations"}.`;
  } finally {
    await database.close();
  }
}
