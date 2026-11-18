import { requestBody } from "./request-body.ts";
import { SessionError } from "./session-error.ts";
import type { SessionMessage } from "@open-qa-stack/domain/sessions";

/** The fields a client may send; the type keeps the list to those of a message. */
const FIELDS = ["text"] as const satisfies readonly (keyof SessionMessage)[];

/** Longest message a person may send, in characters: it is handed whole to the agent at work, as the request that opened the session is. */
export const MAX_MESSAGE_LENGTH = 4000;

/**
 * Reads the body of a message sent to a session.
 *
 * @param body - The body, as the client sent it.
 * @returns What the person says.
 * @throws {@link SessionError} `invalid_request` naming the field at fault: a body that is no JSON object, a
 * field that is none of a message, `text` that is not a text, holds nothing but spaces or is longer than
 * {@link MAX_MESSAGE_LENGTH}.
 */
export function sessionMessageOf(body: unknown): SessionMessage {
  const { text } = requestBody(body, FIELDS, "a message to a session");
  if (typeof text !== "string" || text.trim() === "") throw new SessionError("invalid_request", "text must be a text that is not empty.");
  if (text.length > MAX_MESSAGE_LENGTH) throw new SessionError("invalid_request", `text must not be longer than ${MAX_MESSAGE_LENGTH} characters.`);
  return { text };
}
