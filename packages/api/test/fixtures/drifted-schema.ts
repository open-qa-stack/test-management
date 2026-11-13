import { integer, pgTable } from "drizzle-orm/pg-core";

export * from "../../src/database/schema.ts";

export const undeclared = pgTable("undeclared", { id: integer().primaryKey() });
