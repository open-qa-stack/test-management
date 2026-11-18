import { Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { Database, DatabaseStatus, SchemaMigrations } from "@open-qa-stack/store";
import { PendingMigrationsError } from "./pending-migrations-error.ts";

/**
 * Brings the schema of the database in order before the API listens, or stops the startup.
 *
 * @remarks
 * A database that is a file of this machine belongs to this process alone: its pending migrations are applied
 * here, since there is no one else to warn. A database on a server may be shared, and changing its schema is
 * left to the migration command: the startup stops when it answers but has not applied every migration. A
 * server that cannot be reached does not stop it: the instance then reports itself not ready.
 */
@Injectable()
export class SchemaCheck implements OnApplicationBootstrap {
  readonly #database: Database;
  readonly #migrations: SchemaMigrations;
  readonly #status: DatabaseStatus;

  constructor(database: Database, migrations: SchemaMigrations, status: DatabaseStatus) {
    this.#database = database;
    this.#migrations = migrations;
    this.#status = status;
  }

  /**
   * @throws {@link PendingMigrationsError} when migrations are pending on a server.
   * @throws `DatabaseUnavailableError` when the file of the database cannot be opened.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (this.#database.local) await this.#migrations.apply();
    const state = await this.#status.check();
    if (state.check === "migrations_pending") throw new PendingMigrationsError(state.pending);
  }
}
