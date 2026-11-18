import { setTimeout as pause } from "node:timers/promises";

/** How long a test waits for something to become true before it fails, in milliseconds. */
const PATIENCE_MS = 30_000;

/**
 * Waits until a reading answers something.
 *
 * @param read - What is read again, every few milliseconds, until it answers something other than `undefined` or `false`.
 * @returns What it answered.
 * @throws When it answered nothing in time.
 */
export async function eventually<T>(read: () => T | Promise<T>): Promise<Exclude<T, undefined | false>> {
  const deadline = Date.now() + PATIENCE_MS;
  for (;;) {
    const found = await read();
    if (found !== undefined && found !== false) return found as Exclude<T, undefined | false>;
    if (Date.now() > deadline) throw new Error("What was awaited did not happen in time.");
    await pause(5);
  }
}
