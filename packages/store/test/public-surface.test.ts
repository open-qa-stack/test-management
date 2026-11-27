import assert from "node:assert/strict";
import { describe, it } from "vitest";
import * as store from "../src/index.ts";

describe("the package", () => {
  it("gives the connection, the migrations, the stores of the sessions, of the configuration, of the documents, of the executions, of the campaigns, of the settings of the domains, of the memories and of the tests, and the database of an instance assembled from them, and nothing of its tables", () => {
    assert.deepEqual(Object.keys(store).sort(), [
      "CampaignStore",
      "ConfigurationStore",
      "DATABASE_URL_VARIABLE",
      "Database",
      "DatabaseStatus",
      "DatabaseUnavailableError",
      "DatabaseUrl",
      "DefectStore",
      "DocumentStore",
      "DomainSettingStore",
      "ExecutionStore",
      "InstanceDatabase",
      "MemoryStore",
      "PendingMigrationsError",
      "SchemaMigrations",
      "SessionStore",
      "TestDecisionStore",
      "TestStore",
      "instanceDatabaseUrl",
      "runMigrations",
    ]);
  });
});
