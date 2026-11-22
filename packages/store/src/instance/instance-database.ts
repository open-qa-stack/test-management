import { ConfigurationStore } from "../configuration/configuration-store.ts";
import { Database } from "../database/database.ts";
import { DatabaseStatus } from "../database/database-status.ts";
import { DocumentStore } from "../documents/document-store.ts";
import { CampaignStore } from "../campaigns/campaign-store.ts";
import { ExecutionStore } from "../executions/execution-store.ts";
import { MemoryStore } from "../memory/memory-store.ts";
import { SchemaMigrations } from "../database/schema-migrations.ts";
import { SessionStore } from "../sessions/session-store.ts";
import { TestStore } from "../tests/test-store.ts";
import { MIGRATIONS } from "../database/migrations/index.ts";
import { PendingMigrationsError } from "./pending-migrations-error.ts";
import type { Migration } from "kysely/migration";
import type { DatabaseUrl } from "../database/database-url.ts";
import type { StoreLogger } from "../store-logger.ts";

/**
 * The database of an instance, assembled once for whatever process reaches it — the server that hosts its
 * sessions, a terminal that opens one or reads them: the connection, the migrations, their status, the
 * store of the sessions, that of the configuration, that of the documents of its knowledge sources, that of the executions of tests, that of the campaigns, that of the memories of the agents and that of the tests under their identifiers, with the one rule that brings the schema in order before anything is read.
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
  /** The store of the revisions of the configuration, which the operations on the configuration are given. */
  readonly configuration: ConfigurationStore;
  /** The store of the documents of the knowledge sources, which the operations on documents and the runs are given. */
  readonly documents: DocumentStore;
  /** The store of the executions of tests, which the operations on sessions keep theirs in and the operations on executions read. */
  readonly executions: ExecutionStore;
  /** The store of the campaigns, which the operations on campaigns are given. */
  readonly campaigns: CampaignStore;
  /** The store of the memories of the agents, which the runs are given. */
  readonly memory: MemoryStore;
  /** The store of the tests under their identifiers, which the operations on the tests of the repository are given. */
  readonly tests: TestStore;

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
    this.configuration = new ConfigurationStore(this.database);
    this.documents = new DocumentStore(this.database);
    this.executions = new ExecutionStore(this.database);
    this.campaigns = new CampaignStore(this.database);
    this.memory = new MemoryStore(this.database);
    this.tests = new TestStore(this.database);
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
