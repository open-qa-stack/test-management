import { Logger, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Database, DatabaseStatus, SchemaMigrations } from "@open-qa-stack/store";
import { ApiConfiguration } from "../config/api-configuration.ts";
import { SchemaCheck } from "./schema-check.ts";

/** The context the lines about the database are logged under. */
const CONTEXT = "Database";

/**
 * Provides the database of the instance, its migrations and its status, checks its schema at startup, and
 * closes its connections when the instance stops.
 */
@Module({
  providers: [
    {
      provide: Database,
      useFactory: (configuration: ApiConfiguration) => new Database(configuration.database, new Logger(CONTEXT)),
      inject: [ApiConfiguration],
    },
    { provide: SchemaMigrations, useFactory: (database: Database) => new SchemaMigrations(database), inject: [Database] },
    { provide: DatabaseStatus, useFactory: (migrations: SchemaMigrations) => new DatabaseStatus(migrations, new Logger(CONTEXT)), inject: [SchemaMigrations] },
    SchemaCheck,
  ],
  exports: [Database, SchemaMigrations, DatabaseStatus],
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
