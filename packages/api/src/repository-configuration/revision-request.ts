import { isRecord } from "@open-qa-stack/domain";
import { requestBody } from "../sessions/request-body.ts";
import { SessionError } from "../sessions/session-error.ts";
import type { RevisionChange } from "@open-qa-stack/domain/sessions";

/** A change of the configuration as the route reads it: its document is validated by the operations, not here. */
export interface RevisionRequest {
  readonly basedOn: number;
  readonly document: Readonly<Record<string, unknown>>;
  readonly replaceFile: boolean;
}

/** The fields a client may send; the type keeps the list to those of a change. */
const FIELDS = ["basedOn", "document", "replaceFile"] as const satisfies readonly (keyof RevisionChange)[];

/**
 * Reads a configuration sent as the body of a request.
 *
 * @param document - What the client sent.
 * @returns The configuration, still to validate.
 * @throws {@link SessionError} `invalid_request` for a body that is no JSON object.
 */
export function configurationOf(document: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(document)) throw new SessionError("invalid_request", "The body must be the configuration, a JSON object.");
  return document;
}

/**
 * Reads the body of a request to change the configuration.
 *
 * @param body - The body, as the client sent it.
 * @returns The change.
 * @throws {@link SessionError} `invalid_request` naming the field at fault: a body that is no JSON object, a field
 * that is none of a change, `basedOn` that is no whole number from 0, `document` that is no JSON object,
 * `replaceFile` that is given and is no boolean.
 */
export function revisionRequestOf(body: unknown): RevisionRequest {
  const { basedOn, document, replaceFile = false } = requestBody(body, FIELDS, "a change of the configuration");
  if (typeof basedOn !== "number" || !Number.isSafeInteger(basedOn) || basedOn < 0)
    throw new SessionError("invalid_request", "basedOn must be the number of the revision the change was made from: a whole number, 0 when there was none.");
  if (!isRecord(document)) throw new SessionError("invalid_request", "document must be the configuration, a JSON object.");
  if (typeof replaceFile !== "boolean") throw new SessionError("invalid_request", "replaceFile must be true or false when it is given.");
  return { basedOn, document, replaceFile };
}
