/** Raised when a session is asked of a host that was given no test repository: there is nowhere to run it. */
export class NoRepositoryError extends Error {
  constructor() {
    super("No session can be opened: the host of the sessions was given no test repository.");
    this.name = "NoRepositoryError";
  }
}
