import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/** Keeps with an execution the environment its tests ran against. The executions kept before stay without one. */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable("executions").addColumn("environment", "text").execute();
}

/** The fourteenth migration: the environment of an execution. */
export const executionEnvironments: Migration = { up };
