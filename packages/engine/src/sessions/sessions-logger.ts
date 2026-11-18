/** Where the operations on sessions report what an operator follows: what happens to a session, and what goes wrong around it. */
export interface SessionsLogger {
  /** Reports what happened as expected, or went back to normal. */
  log(message: string): void;
  /** Reports what an operator should look at. */
  warn(message: string): void;
}
