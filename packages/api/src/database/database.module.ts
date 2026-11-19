import { Logger, Module, type OnApplicationShutdown } from "@nestjs/common";
import {
  ConfigurationStore,
  Database,
  DatabaseStatus,
  DocumentStore,
  ExecutionStore,
  InstanceDatabase,
  SchemaMigrations,
  SessionStore,
} from "@open-qa-stack/store";
import { ApiConfiguration } from "../config/api-configuration.ts";
import { SchemaCheck } from "./schema-check.ts";

/**
 * Provides the database of the instance as the store assembles it for every process that reaches it, and
 * each of its parts to whoever needs one — the connection, the migrations, their status, the stores of the
 * sessions, of the configuration, of the documents of the knowledge sources and of the executions of tests; checks its schema at startup, and closes its connections when the instance stops.
 */
@Module({
  providers: [
    {
      provide: InstanceDatabase,
      useFactory: (configuration: ApiConfiguration) => new InstanceDatabase(configuration.database, new Logger("Database")),
      inject: [ApiConfiguration],
    },
    { provide: Database, useFactory: (instance: InstanceDatabase) => instance.database, inject: [InstanceDatabase] },
    { provide: SchemaMigrations, useFactory: (instance: InstanceDatabase) => instance.migrations, inject: [InstanceDatabase] },
    { provide: DatabaseStatus, useFactory: (instance: InstanceDatabase) => instance.status, inject: [InstanceDatabase] },
    { provide: SessionStore, useFactory: (instance: InstanceDatabase) => instance.sessions, inject: [InstanceDatabase] },
    { provide: ConfigurationStore, useFactory: (instance: InstanceDatabase) => instance.configuration, inject: [InstanceDatabase] },
    { provide: DocumentStore, useFactory: (instance: InstanceDatabase) => instance.documents, inject: [InstanceDatabase] },
    { provide: ExecutionStore, useFactory: (instance: InstanceDatabase) => instance.executions, inject: [InstanceDatabase] },
    SchemaCheck,
  ],
  exports: [InstanceDatabase, Database, SchemaMigrations, DatabaseStatus, SessionStore, ConfigurationStore, DocumentStore, ExecutionStore],
})
export class DatabaseModule implements OnApplicationShutdown {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  /** Closes every connection to the database, once nothing uses them any more. */
  async onApplicationShutdown(): Promise<void> {
    await this.#database.close();
  }
}
