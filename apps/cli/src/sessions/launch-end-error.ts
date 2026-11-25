/** A launch of tests that ended without keeping an execution: the runner wrote no report, or the store refused it. */
export class LaunchEndError extends Error {
  /** @param failure - Why it kept none. */
  constructor(failure: string | undefined) {
    super(`The tests ran, but no execution of them is kept: ${failure}`);
    this.name = "LaunchEndError";
  }
}
