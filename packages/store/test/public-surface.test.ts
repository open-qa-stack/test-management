import assert from "node:assert/strict";
import { describe, it } from "vitest";
import * as store from "../src/index.ts";

describe("the package", () => {
  it("gives the connection, the migrations and the store of the sessions, and nothing of its tables", () => {
    assert.deepEqual(Object.keys(store).sort(), [
      "Database",
      "DatabaseStatus",
      "DatabaseUnavailableError",
      "DatabaseUrl",
      "SchemaMigrations",
      "SessionStore",
      "runMigrations",
    ]);
  });
});
