import { ConfigurationStore } from "../../src/configuration/configuration-store.ts";
import { Database } from "../../src/database/database.ts";
import { DatabaseUrl } from "../../src/database/database-url.ts";
import { DocumentStore } from "../../src/documents/document-store.ts";
import { runMigrations } from "../../src/database/run-migrations.ts";
import { SessionStore } from "../../src/sessions/session-store.ts";
import { RecordingLogger } from "./recording-logger.ts";
import type { StoreLogger } from "../../src/store-logger.ts";
import type { DatabaseEngine } from "./database-engine.ts";
import type { TestDatabase } from "./test-database.ts";

/** A database of its own with the schema of the instance, and the stores of the sessions, of the configuration and of the documents on it. */
export class SessionDatabase {
  /** Its connection URL. */
  readonly url: string;
  /** What the store reads and writes through, and the tests with it. */
  readonly database: Database;
  readonly store: SessionStore;
  readonly configuration: ConfigurationStore;
  readonly documents: DocumentStore;
  readonly #own: TestDatabase;

  private constructor(own: TestDatabase, url: DatabaseUrl, logger: StoreLogger) {
    this.#own = own;
    this.url = own.url;
    this.database = new Database(url, logger);
    this.store = new SessionStore(this.database);
    this.configuration = new ConfigurationStore(this.database);
    this.documents = new DocumentStore(this.database);
  }

  /**
   * @param engine - The database to create it on.
   * @param logger - Where a connection that drops is reported; kept aside by default.
   * @returns A new database, its migrations applied.
   */
  static async create(engine: DatabaseEngine, logger: StoreLogger = new RecordingLogger()): Promise<SessionDatabase> {
    const own = await engine.create();
    const url = DatabaseUrl.parse(own.url) as DatabaseUrl;
    await runMigrations(url, logger);
    return new SessionDatabase(own, url, logger);
  }

  /** Empties the tables of the sessions, with their events and their messages, of the project, of the configuration and of the documents. */
  async clear(): Promise<void> {
    await this.database.kysely.deleteFrom("domain_settings").execute();
    await this.database.kysely.deleteFrom("test_decisions").execute();
    await this.database.kysely.deleteFrom("defects").execute();
    await this.database.kysely.deleteFrom("memories").execute();
    await this.database.kysely.deleteFrom("lessons").execute();
    await this.database.kysely.deleteFrom("execution_results").execute();
    await this.database.kysely.deleteFrom("test_versions").execute();
    await this.database.kysely.deleteFrom("tests").execute();
    await this.database.kysely.deleteFrom("executions").execute();
    await this.database.kysely.deleteFrom("campaigns").execute();
    await this.database.kysely.deleteFrom("knowledge_documents").execute();
    await this.database.kysely.deleteFrom("sessions").execute();
    await this.database.kysely.deleteFrom("configuration_revisions").execute();
    await this.database.kysely.deleteFrom("project").execute();
  }

  /** Closes its connections, then removes the database. */
  async drop(): Promise<void> {
    await this.database.close();
    await this.#own.drop();
  }
}
