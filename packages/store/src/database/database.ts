import { openKysely } from "./open-kysely.ts";
import type { Kysely } from "kysely";
import type { StoreLogger } from "../store-logger.ts";
import type { DatabaseUrl } from "./database-url.ts";
import type { StoreSchema } from "./schema.ts";

/** The database of the instance, the only way a process reaches it: the same statements, whichever database its URL names. */
export class Database {
  /** What builds and runs the statements, checked against the schema. */
  readonly kysely: Kysely<StoreSchema>;
  /**
   * Whether the database is a file of this machine, which the process that opens it has to itself: there is
   * then no one else to warn before its schema changes.
   */
  readonly local: boolean;

  /**
   * Opens nothing until a statement needs it.
   *
   * @param url - The connection URL of the database.
   * @param logger - Where a connection dropped while idle is reported.
   */
  constructor(url: DatabaseUrl, logger: StoreLogger) {
    this.kysely = openKysely(url, logger);
    this.local = url.file !== undefined;
  }

  /** Closes every connection to the database. */
  async close(): Promise<void> {
    await this.kysely.destroy();
  }
}
