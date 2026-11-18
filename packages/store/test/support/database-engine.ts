import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedDatabase } from "./isolated-database.ts";
import type { TestDatabase } from "./test-database.ts";

/** A database the store supports, as the tests see it: what gives each test file databases of its own. */
export interface DatabaseEngine {
  readonly name: "sqlite" | "postgres";
  /** @returns A new, empty database, which no other test file sees. */
  create(): Promise<TestDatabase>;
}

/** SQLite: each database is a file in a folder of its own, removed with it. Nothing has to run beside the tests. */
export const SQLITE: DatabaseEngine = {
  name: "sqlite",
  create: async () => {
    const folder = mkdtempSync(join(tmpdir(), "oqas-test-sqlite-"));
    return { url: `sqlite:${join(folder, "oqas.db")}`, drop: async () => rmSync(folder, { recursive: true, force: true }) };
  },
};

/** PostgreSQL: each database is one of the test server, which `OQAS_TEST_DATABASE_URL` names. */
export const POSTGRES: DatabaseEngine = { name: "postgres", create: isolatedDatabase };

/**
 * @returns The database the tests of this process run on, which `OQAS_TEST_DATABASE` names: the tests written
 * for every database are run once on each.
 * @throws When the variable names none of them.
 */
export function engineUnderTest(): DatabaseEngine {
  const named = process.env["OQAS_TEST_DATABASE"];
  const engine = [SQLITE, POSTGRES].find(({ name }) => name === named);
  if (engine === undefined) throw new Error(`OQAS_TEST_DATABASE names no database of the tests: ${String(named)}.`);
  return engine;
}
