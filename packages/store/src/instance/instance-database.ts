import { Database } from "../database/database.ts";
import { DatabaseStatus } from "../database/database-status.ts";
import { SchemaMigrations } from "../database/schema-migrations.ts";
import { SessionStore } from "../sessions/session-store.ts";
import { MIGRATIONS } from "../database/migrations/index.ts";
import { PendingMigrationsError } from "./pending-migrations-error.ts";
import type { Migration } from "kysely/migration";
import type { DatabaseUrl } from "../database/database-url.ts";
import type { StoreLogger } from "../store-logger.ts";

/**
 * The database of an instance, assembled once for whatever process reaches it — the server that hosts its
 * sessions, a terminal that opens one or reads them: the connection, the migrations, their status and the
 * store of the sessions, with the one rule that brings the schema in order before anything is read.
 *
 * @remarks
 * Nothing is opened until a statement needs it: a process may assemble the database of a server that does not
 * answer yet, and report itself not ready.
 */
export class InstanceDatabase {
  /** The connection to the database. */
  readonly database: Database;
  /** The versioned migrations of its schema. */
  readonly migrations: SchemaMigrations;
  /** Whether it answers, with its schema up to date. */
  readonly status: DatabaseStatus;
  /** The store of the sessions, which the operations on sessions are given. */
  readonly sessions: SessionStore;

  /**
   * @param url - The connection URL of the database, as `instanceDatabaseUrl` resolves it.
   * @param logger - Where the changes of the state of the database and a connection that drops are reported.
   * @param migrations - The migrations, each under its name; those of the package by default.
   */
  constructor(url: DatabaseUrl, logger: StoreLogger, migrations: Readonly<Record<string, Migration>> = MIGRATIONS) {
    this.database = new Database(url, logger);
    this.migrations = new SchemaMigrations(this.database, migrations);
    this.status = new DatabaseStatus(this.migrations, logger);
    this.sessions = new SessionStore(this.database);
  }

  /**
   * Brings the schema of the database in order, or refuses to go on.
   *
   * @remarks
   * A database that is a file of this machine belongs to the processes of one instance on it: its pending
   * migrations are applied here, by whichever process comes first. A database on a server may be shared, and
   * changing its schema is left to the migration command. A server that cannot be reached is not refused: the
   * check reports it, and what reads the database next raises that it is unavailable.
   *
   * @throws {@link PendingMigrationsError} when migrations are pending on a server.
   * @throws `DatabaseUnavailableError` when the file of the database cannot be opened.
   */
  async prepare(): Promise<void> {
    if (this.database.local) await this.migrations.apply();
    const state = await this.status.check();
    if (state.check === "migrations_pending") throw new PendingMigrationsError(state.pending);
  }

  /** Closes every connection to the database. */
  async close(): Promise<void> {
    await this.database.close();
  }
}
