import { SessionError } from "./session-error.ts";

const EVENT_ID = /^[0-9]{1,15}$/;

/**
 * Reads the identifier of the last event a client says it got.
 *
 * @param name - What the client sent it as, named in the refusal.
 * @param value - What it sent; `undefined` when it sent nothing.
 * @returns The identifier; `undefined` when the client sent none.
 * @throws {@link SessionError} `invalid_request` when the value is no identifier: resuming from the start
 * instead would hand the client every event twice without telling it.
 */
export function eventIdOf(name: string, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !EVENT_ID.test(value)) {
    throw new SessionError("invalid_request", `${name} must be the identifier of an event: a whole number.`);
  }
  return Number(value);
}
