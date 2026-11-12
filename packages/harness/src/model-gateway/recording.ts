import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import type { CanonicalRequest } from "./canonical-request.ts";
import { RecordingFormatError } from "./recording-format-error.ts";
import { recordingSchema } from "./recording-schema.ts";

/** Who or what produced a recording. */
export type RecordingOrigin =
  /** Captured from a real model server in `record` mode. */
  | { readonly kind: "recorded"; readonly model: string; readonly server: string; readonly recordedOn: string }
  /** Written for a test scenario; no model produced it. */
  | { readonly kind: "handwritten"; readonly purpose: string };

/** A request and the response the model server gave it. */
export interface Exchange {
  readonly request: CanonicalRequest;
  /** Body of the chat completion response, as the server sent it. */
  readonly response: unknown;
}

/** The content of a recording file. */
export interface Recording {
  readonly formatVersion: 1;
  readonly origin: RecordingOrigin;
  readonly exchanges: readonly Exchange[];
}

const validateRecording = new Ajv2020({ allErrors: true, strict: true }).compile<Recording>(recordingSchema);

/**
 * Reads a recording file.
 *
 * @param content - The content of the file.
 * @returns The recording.
 * @throws RecordingFormatError when the content is not a recording of format version 1.
 */
export function parseRecording(content: string): Recording {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new RecordingFormatError("The recording is not valid JSON.");
  }
  if (!validateRecording(data)) {
    // Ajv always sets `errors` when validation fails.
    const where = (validateRecording.errors as ErrorObject[])[0]!.instancePath || "/";
    throw new RecordingFormatError(`The recording does not match format version 1: ${where} is invalid.`);
  }
  return data;
}

/**
 * Writes a recording as it is stored in a file.
 *
 * @param recording - The recording to write.
 * @returns Indented JSON ending with a new line.
 */
export function serializeRecording(recording: Recording): string {
  return `${JSON.stringify(recording, null, 2)}\n`;
}
