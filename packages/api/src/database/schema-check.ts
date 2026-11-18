import { Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { InstanceDatabase } from "@open-qa-stack/store";

/**
 * Brings the schema of the database in order before the API listens, or stops the startup: the rule is the
 * one every process of an instance follows, which the store holds.
 *
 * @remarks
 * A database that is a file of this machine has its pending migrations applied here. A database on a server
 * may be shared, and changing its schema is left to the migration command: the startup stops when it answers
 * but has not applied every migration. A server that cannot be reached does not stop it: the instance then
 * reports itself not ready.
 */
@Injectable()
export class SchemaCheck implements OnApplicationBootstrap {
  readonly #instance: InstanceDatabase;

  constructor(instance: InstanceDatabase) {
    this.#instance = instance;
  }

  /**
   * @throws `PendingMigrationsError` when migrations are pending on a server.
   * @throws `DatabaseUnavailableError` when the file of the database cannot be opened.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.#instance.prepare();
  }
}
