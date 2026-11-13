import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { migrationDrift } from "./support/migration-drift.ts";

const SOURCE = fileURLToPath(new URL("../..", import.meta.url));
const SCHEMA = `${SOURCE}src/database/schema.ts`;
const MIGRATIONS = `${SOURCE}migrations`;

describe("the declared schema and the versioned migrations", () => {
  it("match: generating a migration from the declared schema adds none", async () => {
    assert.deepEqual(await migrationDrift(SCHEMA, MIGRATIONS), []);
  });

  it("differ once the declared schema changes without a migration, which the check reports", async () => {
    const added = await migrationDrift(`${SOURCE}test/fixtures/drifted-schema.ts`, MIGRATIONS);
    assert.equal(added.length, 1, "a table declared without its migration must be reported");
  });
});
