import { Module } from "@nestjs/common";
import { ApiConfiguration } from "../config/api-configuration.ts";
import { Database } from "./database.ts";
import { DatabaseStatus } from "./database-status.ts";
import { MIGRATIONS_FOLDER } from "./migrations-folder.ts";
import { SchemaCheck } from "./schema-check.ts";
import { SchemaMigrations } from "./schema-migrations.ts";

/** Provides the database of the instance, its migrations and its status, and checks its schema at startup. */
@Module({
  providers: [
    { provide: Database, useFactory: (configuration: ApiConfiguration) => new Database(configuration.database), inject: [ApiConfiguration] },
    { provide: SchemaMigrations, useFactory: (database: Database) => new SchemaMigrations(database, MIGRATIONS_FOLDER), inject: [Database] },
    DatabaseStatus,
    SchemaCheck,
  ],
  exports: [Database, SchemaMigrations, DatabaseStatus],
})
export class DatabaseModule {}
