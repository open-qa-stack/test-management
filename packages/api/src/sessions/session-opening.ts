import { requestBody } from "./request-body.ts";
import { SessionError } from "./session-error.ts";
import type { SessionOpening } from "@open-qa-stack/shared/sessions";

/** The fields a client may send; the type keeps the list to those of an opening. */
const FIELDS = ["request", "environment"] as const satisfies readonly (keyof SessionOpening)[];

/** Longest request a person may send, in characters: it is handed whole to the agents, and to a command line as one argument. */
export const MAX_REQUEST_LENGTH = 4000;

/**
 * Whether a value is a text a session can be opened with: one that holds more than spaces, and that a
 * command line cannot take for one of its options.
 */
function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !value.startsWith("--");
}

/**
 * Reads the body of a request to open a session.
 *
 * @param body - The body, as the client sent it.
 * @returns What to test, and the environment when the client names one.
 * @throws {@link SessionError} `invalid_request` naming the field at fault: a body that is no JSON object, a
 * field that is none of an opening, `request` that is not a text, is empty, starts with `--` or is longer than
 * {@link MAX_REQUEST_LENGTH}, `environment` that is given and is not a text, is empty or starts with `--`.
 */
export function sessionOpeningOf(body: unknown): SessionOpening {
  const { request, environment } = requestBody(body, FIELDS, "a request to open a session");
  if (!isText(request)) throw new SessionError("invalid_request", "request must be a text that is not empty and does not start with --.");
  if (request.length > MAX_REQUEST_LENGTH) throw new SessionError("invalid_request", `request must not be longer than ${MAX_REQUEST_LENGTH} characters.`);
  if (environment === undefined) return { request };
  if (!isText(environment)) {
    throw new SessionError("invalid_request", "environment must be a text that is not empty and does not start with -- when it is given.");
  }
  return { request, environment };
}
