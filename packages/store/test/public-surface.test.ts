import assert from "node:assert/strict";
import { describe, it } from "vitest";
import * as store from "../src/index.ts";

describe("the package", () => {
  it("gives the connection, the migrations, the store of the sessions and the database of an instance assembled from them, and nothing of its tables", () => {
    assert.deepEqual(Object.keys(store).sort(), [
      "DATABASE_URL_VARIABLE",
      "Database",
      "DatabaseStatus",
      "DatabaseUnavailableError",
      "DatabaseUrl",
      "InstanceDatabase",
      "PendingMigrationsError",
      "SchemaMigrations",
      "SessionStore",
      "instanceDatabaseUrl",
      "runMigrations",
    ]);
  });
});
