/**
 * Raised when a process that needs the database of an instance finds that a server has not applied every
 * versioned migration: changing the schema of a server is an explicit step, which no startup takes by itself.
 */
export class PendingMigrationsError extends Error {
  /** How many migrations the database has not applied. */
  readonly pending: number;

  /** @param pending - How many migrations the database has not applied. */
  constructor(pending: number) {
    super(
      `The database schema is not up to date: ${pending} ${pending === 1 ? "migration is" : "migrations are"} pending. ` +
        "Apply them with the migration command, then start again.",
    );
    this.name = "PendingMigrationsError";
    this.pending = pending;
  }
}
