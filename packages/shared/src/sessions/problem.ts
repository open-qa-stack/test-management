/**
 * Why the API refused or failed, as a code a client can act on: the session asked for does not exist, the
 * request is not valid, a session is already running, the session no longer goes on and takes no message, no source of sessions is configured, the session could
 * not be opened, or its opening took too long; `error` for anything else.
 */
export type ProblemCode =
  "unknown_session" | "invalid_request" | "session_running" | "session_ended" | "unavailable" | "not_opened" | "opening_timed_out" | "error";

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
}
