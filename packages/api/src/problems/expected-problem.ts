import { HttpException, HttpStatus } from "@nestjs/common";
import { isRecord, SessionEndedError, UnknownSessionError } from "@open-qa-stack/domain";
import { NoRepositoryError } from "@open-qa-stack/engine";
import { DatabaseUnavailableError } from "@open-qa-stack/store";
import { API_VARIABLES } from "../config/api-variables.ts";
import { SessionError } from "../sessions/session-error.ts";
import { problemOf } from "./problem-kinds.ts";
import type { Problem } from "@open-qa-stack/domain/sessions";

/** What a client is told while the instance cannot reach its database: nothing of the database, and what to do. */
const DATABASE_UNAVAILABLE = "The database of the instance cannot be reached, and its sessions with it: try again once the instance reports itself ready.";

/** What a client is told when it opens a session on an API that has no test repository to run it in: what to set, and where. */
const NO_REPOSITORY = `The API was started without a test repository, and opens no session: set ${API_VARIABLES.repository.name} to ${API_VARIABLES.repository.type.rule}, and start the API again.`;

/** The problem of a request the HTTP layer refused with a status: a malformed one is `invalid_request`, any other keeps its status. */
function refusalOf(status: number, detail: string): Problem {
  return status === HttpStatus.BAD_REQUEST ? problemOf("invalid_request", detail) : problemOf("error", detail, status);
}

/**
 * Reads an error as the problem a client is told, when the error is one the API expects.
 *
 * @remarks
 * Five kinds of errors are expected: those the routes raise for a request they cannot read, the refusals of
 * the operations on sessions — a session that does not exist, one that ended, no test repository to run one
 * in — a database that cannot be reached, those the framework raises for a request it refuses — an unknown
 * route, a method that is not allowed — and those the HTTP server raises with a client status before a route
 * is reached — a body that is not JSON, a media type it does not read. Their messages are written for the
 * client, but that of the database, which may name its host: the client is told what to do instead. Anything
 * else is a failure of the API, whose message may reveal what it runs on.
 *
 * @param error - What was raised.
 * @returns The problem; `undefined` for an error the API does not expect.
 */
export function expectedProblem(error: unknown): Problem | undefined {
  if (error instanceof SessionError) return error.problem();
  if (error instanceof UnknownSessionError) return problemOf("unknown_session", error.message);
  if (error instanceof SessionEndedError)
    return problemOf("session_ended", `${error.message} It takes no message and no interruption: open another session to go on.`);
  if (error instanceof NoRepositoryError) return problemOf("unavailable", NO_REPOSITORY);
  if (error instanceof DatabaseUnavailableError) return problemOf("unavailable", DATABASE_UNAVAILABLE);
  if (error instanceof HttpException) return refusalOf(error.getStatus(), error.message);
  if (!isRecord(error)) return undefined;
  const { statusCode, message } = error;
  if (typeof statusCode !== "number" || statusCode < 400 || statusCode > 499 || typeof message !== "string") return undefined;
  return refusalOf(statusCode, message);
}
