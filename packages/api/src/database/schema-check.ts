import { Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { DatabaseStatus } from "./database-status.ts";
import { PendingMigrationsError } from "./pending-migrations-error.ts";

/**
 * Stops the startup when the database answers but has not applied every versioned migration. A database
 * that cannot be reached does not stop it: the instance then reports itself not ready.
 */
@Injectable()
export class SchemaCheck implements OnApplicationBootstrap {
  readonly #status: DatabaseStatus;

  constructor(status: DatabaseStatus) {
    this.#status = status;
  }

  /** @throws {@link PendingMigrationsError} when migrations are pending. */
  async onApplicationBootstrap(): Promise<void> {
    const state = await this.#status.check();
    if (state.check === "migrations_pending") throw new PendingMigrationsError(state.pending);
  }
}
