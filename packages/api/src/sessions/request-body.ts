import { isRecord } from "../json.ts";
import { SessionError } from "./session-error.ts";

/**
 * Reads the body of a request as an object that holds nothing but the fields the route knows: a field a
 * client misspelt is refused rather than ignored, which would answer a request the client did not make.
 *
 * @param body - The body, as the client sent it.
 * @param fields - The fields the route knows.
 * @param what - What the body is, named in the refusal of a field that is none of it.
 * @returns The body.
 * @throws {@link SessionError} `invalid_request` for a body that is no JSON object, and for a field that is none of the route, which it names.
 */
export function requestBody(body: unknown, fields: readonly string[], what: string): Readonly<Record<string, unknown>> {
  if (!isRecord(body)) throw new SessionError("invalid_request", "The body must be a JSON object.");
  const unknown = Object.keys(body).find((field) => !fields.includes(field));
  if (unknown !== undefined) throw new SessionError("invalid_request", `${unknown} is not a field of ${what}.`);
  return body;
}
