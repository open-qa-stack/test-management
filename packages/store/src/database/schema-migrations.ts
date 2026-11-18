import { Migrator, type Migration } from "kysely/migration";
import { MIGRATIONS } from "./migrations/index.ts";
import type { Database } from "./database.ts";

/** The versioned migrations of the schema, and the record of those the database has applied. */
export class SchemaMigrations {
  readonly #migrator: Migrator;

  /**
   * @param database - The database the migrations apply to.
   * @param migrations - The migrations, each under its name; those of the package by default.
   */
  constructor(database: Database, migrations: Readonly<Record<string, Migration>> = MIGRATIONS) {
    this.#migrator = new Migrator({ db: database.kysely, provider: { getMigrations: () => Promise.resolve({ ...migrations }) } });
  }

  /**
   * @returns How many versioned migrations the database has not applied yet.
   * @throws {@link DatabaseUnavailableError} when the database cannot be reached.
   */
  async pending(): Promise<number> {
    const migrations = await this.#migrator.getMigrations();
    return migrations.filter(({ executedAt }) => executedAt === undefined).length;
  }

  /**
   * Applies, in the order of their names, every migration the database has not applied yet. On a server that
   * undoes a change of schema with its transaction, PostgreSQL, the series is one transaction, and two
   * processes that migrate the same database at once apply each migration once.
   *
   * @returns How many migrations were applied.
   * @throws {@link DatabaseUnavailableError} when the database cannot be reached.
   * @throws The error of a migration that failed, which stays pending.
   */
  async apply(): Promise<number> {
    const { error, results = [] } = await this.#migrator.migrateToLatest();
    if (error !== undefined) throw error;
    return results.length;
  }
}
