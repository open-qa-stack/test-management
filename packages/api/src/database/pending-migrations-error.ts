/** Raised at startup when the database has not applied every versioned migration of the API. */
export class PendingMigrationsError extends Error {
  /** How many migrations the database has not applied. */
  readonly pending: number;

  constructor(pending: number) {
    super(
      `The database schema is not up to date: ${pending} ${pending === 1 ? "migration is" : "migrations are"} pending. ` +
        "Apply them with the migration command, then start the API again.",
    );
    this.name = "PendingMigrationsError";
    this.pending = pending;
  }
}
