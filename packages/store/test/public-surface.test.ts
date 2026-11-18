import assert from "node:assert/strict";
import { describe, it } from "vitest";
import * as store from "../src/index.ts";

describe("the package", () => {
  it("gives the connection, the migrations, the stores of the sessions, of the configuration and of the documents, and the database of an instance assembled from them, and nothing of its tables", () => {
    assert.deepEqual(Object.keys(store).sort(), [
      "ConfigurationStore",
      "DATABASE_URL_VARIABLE",
      "Database",
      "DatabaseStatus",
      "DatabaseUnavailableError",
      "DatabaseUrl",
      "DocumentStore",
      "InstanceDatabase",
      "PendingMigrationsError",
      "SchemaMigrations",
      "SessionStore",
      "instanceDatabaseUrl",
      "runMigrations",
    ]);
  });
});
