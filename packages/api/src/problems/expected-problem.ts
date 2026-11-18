import { HttpException, HttpStatus } from "@nestjs/common";
import {
  CONFIG_FILE_NAME,
  ConfigurationConflictError,
  InvalidConfigurationError,
  isRecord,
  NoConfigurationError,
  SessionEndedError,
  SessionStateError,
  StaleRevisionError,
  UnknownSessionError,
} from "@open-qa-stack/domain";
import { NoRepositoryError } from "@open-qa-stack/engine";
import { DatabaseUnavailableError } from "@open-qa-stack/store";
import { API_VARIABLES } from "../config/api-variables.ts";
import { SessionError } from "../sessions/session-error.ts";
import { problemOf } from "./problem-kinds.ts";
import type { Problem } from "@open-qa-stack/domain/sessions";

/** What a client is told while the instance cannot reach its database: nothing of the database, and what to do. */
const DATABASE_UNAVAILABLE = "The database of the instance cannot be reached, and its sessions with it: try again once the instance reports itself ready.";

/** What a client is told when it asks for what needs a test repository of an API that has none: what to set, and where. */
const NO_REPOSITORY = `The API was started without a test repository: it opens no session and changes no configuration. Set ${API_VARIABLES.repository.name} to ${API_VARIABLES.repository.type.rule}, and start the API again.`;

/** What a client is told of a change made from a revision another replaced since: where to make it from. */
const STALE = "Read the configuration again, and make the change from the revision in force.";

/** What a client is told of a change that would overwrite a file that changed too: the two ways out, each one request. */
const CONFLICT = `Keep the file: POST /api/configuration/synchronisation makes it the revision in force. Or keep the change: send it again with "replaceFile": true, which rewrites ${CONFIG_FILE_NAME}.`;

/** What a client is told of a configuration that is not valid. */
const INVALID = `Each error is in errors, where it is. A file that is not valid is corrected, or replaced by a change sent with "replaceFile": true.`;

/** What a client is told of an instance that has no configuration: the two ways to give it one. */
const NONE = `Write ${CONFIG_FILE_NAME} at the root of the test repository, or save a configuration made from the revision 0.`;

/** The problem of a request the HTTP layer refused with a status: a malformed one is `invalid_request`, any other keeps its status. */
function refusalOf(status: number, detail: string): Problem {
  return status === HttpStatus.BAD_REQUEST ? problemOf("invalid_request", detail) : problemOf("error", detail, status);
}

/**
 * Reads an error as the problem a client is told, when the error is one the API expects.
 *
 * @remarks
 * Five kinds of errors are expected: those the routes raise for a request they cannot read, the refusals of
 * the operations on sessions — a session that does not exist, one that ended, one that goes on and is resumed,
 * no test repository to run one in — and on the configuration — a stale revision, a file that changed too, a
 * configuration that is not valid, none at all — a database that cannot be reached, those the framework raises for a request it refuses — an unknown
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
    return problemOf("session_ended", `${error.message} It takes no message and no interruption: resume it with a message to go on.`);
  if (error instanceof SessionStateError) return problemOf("session_running", `${error.message} It goes on: send it a message instead.`);
  if (error instanceof NoRepositoryError) return problemOf("unavailable", NO_REPOSITORY);
  if (error instanceof StaleRevisionError) return problemOf("stale_revision", `${error.message} ${STALE}`);
  if (error instanceof ConfigurationConflictError) return problemOf("configuration_conflict", `${error.message} ${CONFLICT}`);
  if (error instanceof InvalidConfigurationError) return { ...problemOf("invalid_configuration", `${error.message} ${INVALID}`), errors: error.errors };
  if (error instanceof NoConfigurationError) return problemOf("no_configuration", `${error.message} ${NONE}`);
  if (error instanceof DatabaseUnavailableError) return problemOf("unavailable", DATABASE_UNAVAILABLE);
  if (error instanceof HttpException) return refusalOf(error.getStatus(), error.message);
  if (!isRecord(error)) return undefined;
  const { statusCode, message } = error;
  if (typeof statusCode !== "number" || statusCode < 400 || statusCode > 499 || typeof message !== "string") return undefined;
  return refusalOf(statusCode, message);
}
