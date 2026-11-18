import { vi } from "vitest";

/**
 * Waits until a check passes.
 *
 * @param check - What is run again, every few milliseconds, until it no longer throws.
 * @param withinMs - How long it may take; a run of the whole chain takes seconds.
 * @returns What it returned.
 * @throws What it threw last, when it did not pass in time.
 */
export function eventually<T>(check: () => T | Promise<T>, withinMs = 60_000): Promise<T> {
  return vi.waitFor(check, { timeout: withinMs, interval: 10 });
}
