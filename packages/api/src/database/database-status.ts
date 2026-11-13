import { Injectable, Logger } from "@nestjs/common";
import { DatabaseUnavailableError } from "./database-unavailable-error.ts";
import { SchemaMigrations } from "./schema-migrations.ts";
import type { DatabaseState } from "./database-state.ts";

/** Checks the database of the instance, and logs each change of its state once, from the first check on. */
@Injectable()
export class DatabaseStatus {
  readonly #migrations: SchemaMigrations;
  readonly #logger = new Logger("Database");
  #last: DatabaseState["check"] | undefined;

  constructor(migrations: SchemaMigrations) {
    this.#migrations = migrations;
  }

  /**
   * Checks that the database answers and has applied every migration.
   *
   * @returns What the check found.
   * @throws An error of the database other than its being unreachable, such as an unreadable journal.
   */
  async check(): Promise<DatabaseState> {
    const { state, reason } = await this.#probe();
    if (state.check !== this.#last) {
      if (state.check === "up") this.#logger.log(reason);
      else this.#logger.warn(reason);
      this.#last = state.check;
    }
    return state;
  }

  async #probe(): Promise<{ state: DatabaseState; reason: string }> {
    let pending: number;
    try {
      pending = await this.#migrations.pending();
    } catch (error) {
      if (!(error instanceof DatabaseUnavailableError)) throw error;
      return { state: { check: "unreachable" }, reason: error.message };
    }
    if (pending > 0) return { state: { check: "migrations_pending", pending }, reason: "The database schema is not up to date: migrations are pending." };
    return { state: { check: "up" }, reason: "The database is reachable and its schema is up to date." };
  }
}
