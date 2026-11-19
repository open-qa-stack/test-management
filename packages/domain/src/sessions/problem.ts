import type { ConfigError } from "../config/types.ts";

/**
 * Why the API refused or failed, as a code a client can act on: the session asked for does not exist, the
 * request is not valid, the session goes on and takes a message rather than a resumption, the session no longer
 * goes on and takes no message until it is resumed, no source of sessions is configured, the session could not
 * be opened, or its opening took too long; for the configuration, a change made from a revision another
 * replaced since, a change that would overwrite a configuration file that changed too, a configuration that is not
 * valid, or an instance that has none; for the documents of the knowledge sources, a source the configuration in force
 * does not declare as one whose documents the instance keeps, a document the source does not hold, or documents an
 * upload brought that are refused; for the tests of the repository, a capture the latest run of a test did not
 * attach; `error` for anything else.
 */
export type ProblemCode =
  | "unknown_session"
  | "invalid_request"
  | "session_running"
  | "session_ended"
  | "unavailable"
  | "not_opened"
  | "opening_timed_out"
  | "stale_revision"
  | "configuration_conflict"
  | "invalid_configuration"
  | "no_configuration"
  | "unknown_document_source"
  | "unknown_document"
  | "invalid_documents"
  | "unknown_capture"
  | "error";

/**
 * The body of every answer of the API that is not a success, as RFC 9457 describes a problem, served as
 * `application/problem+json`. A client decides on `code`, and shows `detail` when it has no wording of its own.
 */
export interface Problem {
  /** A URI reference that names the kind of problem. */
  readonly type: string;
  /** The kind of problem, in a few words; the same for every occurrence. */
  readonly title: string;
  /** The HTTP status of the answer. */
  readonly status: number;
  /** What went wrong this time, and what to do about it. */
  readonly detail: string;
  readonly code: ProblemCode;
  /** For `invalid_configuration`, every error of the configuration, each where it is; for `invalid_documents`, every error of the upload, each at its document. */
  readonly errors?: readonly ConfigError[];
}
