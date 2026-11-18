import { sessions } from "./0001-sessions.ts";
import type { Migration } from "kysely/migration";

/**
 * The versioned migrations of the schema, each under its name: they are applied in the order of their names,
 * each one once, and run unchanged on every database the store supports.
 */
export const MIGRATIONS: Readonly<Record<string, Migration>> = { "0001_sessions": sessions };
