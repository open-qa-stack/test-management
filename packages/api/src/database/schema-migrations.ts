import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import type { PoolClient } from "pg";
import type { Database } from "./database.ts";

const JOURNAL_SCHEMA = "drizzle";
const JOURNAL_TABLE = "__drizzle_migrations";
// Any constant shared by every process that migrates the same database.
const MIGRATION_LOCK = 4_217_031_877;

/** The versioned migrations of the schema, and the record of those the database has applied. */
export class SchemaMigrations {
  readonly #database: Database;
  readonly #folder: string;
  readonly #migrations: readonly MigrationMeta[];

  /**
   * @param database - The database the migrations apply to.
   * @param folder - The folder of the migrations and of their journal.
   * @throws When the folder holds no journal, or a migration the journal names is missing.
   */
  constructor(database: Database, folder: string) {
    this.#database = database;
    this.#folder = folder;
    this.#migrations = readMigrationFiles({ migrationsFolder: folder });
  }

  /**
   * @returns How many versioned migrations the database has not applied yet.
   * @throws {@link DatabaseUnavailableError} when the database cannot be reached.
   */
  pending(): Promise<number> {
    return this.#database.withClient((client) => this.#pendingOn(client));
  }

  /**
   * Applies, in order and in one transaction, every migration the database has not applied yet. Two
   * processes that migrate the same database at once apply each migration once.
   *
   * @returns How many migrations were applied.
   * @throws {@link DatabaseUnavailableError} when the database cannot be reached.
   */
  apply(): Promise<number> {
    return this.#database.withClient(async (client) => {
      await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
      try {
        const pending = await this.#pendingOn(client);
        await migrate(drizzle({ client }), { migrationsFolder: this.#folder, migrationsSchema: JOURNAL_SCHEMA, migrationsTable: JOURNAL_TABLE });
        return pending;
      } finally {
        await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]);
      }
    });
  }

  async #pendingOn(client: PoolClient): Promise<number> {
    const journal = `${JOURNAL_SCHEMA}.${JOURNAL_TABLE}`;
    const found = await client.query<{ exists: boolean }>("select to_regclass($1) is not null as exists", [journal]);
    if (!(found.rows[0] as { exists: boolean }).exists) return this.#migrations.length;
    const applied = await client.query<{ last: string | null }>(`select max(created_at) as last from ${journal}`);
    const { last } = applied.rows[0] as { last: string | null };
    return this.#migrations.filter((migration) => last === null || migration.folderMillis > Number(last)).length;
  }
}
