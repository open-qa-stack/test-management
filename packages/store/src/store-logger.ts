/**
 * Where the store reports what happens to its connections. The store brings no logger of its own: whoever
 * runs it hands over the one of its process, so that these lines are written where its other lines are.
 */
export interface StoreLogger {
  /** Reports what went back to normal. */
  log(message: string): void;
  /** Reports what an operator should look at. */
  warn(message: string): void;
}
