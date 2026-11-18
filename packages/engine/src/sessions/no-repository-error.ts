/** Raised when a host that was given no test repository is asked for what needs one: a session to run, a file to write. */
export class NoRepositoryError extends Error {
  /** @param refused - What cannot be done, such as `No session can be opened`. */
  constructor(refused = "No session can be opened") {
    super(`${refused}: the host was given no test repository.`);
    this.name = "NoRepositoryError";
  }
}
