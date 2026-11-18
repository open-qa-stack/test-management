/** Something a test holds until it lets it go: a promise, and what settles it. */
export interface Held {
  /** Settles once the test let go. */
  readonly promise: Promise<void>;
  /** Lets go. */
  readonly resolve: () => void;
}

/** @returns Something held, which whoever awaits it waits for until the test lets go. */
export function held(): Held {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
