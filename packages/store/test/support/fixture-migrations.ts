import type { Migration } from "kysely/migration";

/** Two migrations that have nothing of the schema of the instance: each creates one table. */
export const FIXTURE_MIGRATIONS: Readonly<Record<string, Migration>> = {
  "0001_items": {
    up: (database) =>
      database.schema
        .createTable("fixture_items")
        .addColumn("id", "integer", (column) => column.primaryKey())
        .execute(),
  },
  "0002_notes": {
    up: (database) =>
      database.schema
        .createTable("fixture_notes")
        .addColumn("id", "integer", (column) => column.primaryKey())
        .execute(),
  },
};

/**
 * @param count - How many of the fixture migrations to keep: 0, 1 or 2.
 * @returns The first ones, as a version of the package that knew no other would hold them.
 */
export function firstFixtureMigrations(count: number): Readonly<Record<string, Migration>> {
  return Object.fromEntries(Object.entries(FIXTURE_MIGRATIONS).slice(0, count));
}
