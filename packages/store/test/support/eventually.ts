import { vi } from "vitest";

/**
 * Waits until a check passes.
 *
 * @param check - What is run again, every few milliseconds, until it no longer throws.
 * @returns What it returned.
 * @throws What it threw last, when it did not pass in five seconds.
 */
export function eventually<T>(check: () => T | Promise<T>): Promise<T> {
  return vi.waitFor(check, { timeout: 5_000, interval: 5 });
}
