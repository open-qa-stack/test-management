/**
 * Raised when the database cannot be reached or drops the connection.
 *
 * @remarks
 * The message never holds the connection URL nor its password.
 */
export class DatabaseUnavailableError extends Error {
  /** @param reason - Why the database is unavailable, already redacted. */
  constructor(reason: string) {
    super(`The database is unreachable: ${reason}`);
    this.name = "DatabaseUnavailableError";
  }
}
