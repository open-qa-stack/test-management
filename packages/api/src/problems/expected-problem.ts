import { HttpException, HttpStatus } from "@nestjs/common";
import { isRecord } from "../json.ts";
import { SessionError } from "../sessions/session-error.ts";
import { problemOf } from "./problem-kinds.ts";
import type { Problem } from "@open-qa-stack/shared/sessions";

/** The problem of a request the HTTP layer refused with a status: a malformed one is `invalid_request`, any other keeps its status. */
function refusalOf(status: number, detail: string): Problem {
  return status === HttpStatus.BAD_REQUEST ? problemOf("invalid_request", detail) : problemOf("error", detail, status);
}

/**
 * Reads an error as the problem a client is told, when the error is one the API expects.
 *
 * @remarks
 * Three kinds of errors are expected: those the sessions raise, those the framework raises for a request it
 * refuses — an unknown route, a method that is not allowed — and those the HTTP server raises with a client
 * status before a route is reached — a body that is not JSON, a media type it does not read. Their messages
 * are written for the client. Anything else is a failure of the API, whose message may reveal what it runs on.
 *
 * @param error - What was raised.
 * @returns The problem; `undefined` for an error the API does not expect.
 */
export function expectedProblem(error: unknown): Problem | undefined {
  if (error instanceof SessionError) return error.problem();
  if (error instanceof HttpException) return refusalOf(error.getStatus(), error.message);
  if (!isRecord(error)) return undefined;
  const { statusCode, message } = error;
  if (typeof statusCode !== "number" || statusCode < 400 || statusCode > 499 || typeof message !== "string") return undefined;
  return refusalOf(statusCode, message);
}
