import { HttpException, HttpStatus } from "@nestjs/common";
import {
  CONFIG_FILE_NAME,
  InvalidConfigurationError,
  InvalidDocumentsError,
  isRecord,
  LaunchRefusedError,
  CampaignRefusedError,
  UnknownCampaignError,
  NoConfigurationError,
  SessionEndedError,
  SessionStateError,
  StaleRevisionError,
  UnknownCaptureError,
  UnknownTraceError,
  UnknownTestError,
  TestChangeRefusedError,
  UnknownDocumentError,
  UnknownDocumentSourceError,
  UnknownExecutionError,
  UnknownProposalError,
  ReviewRefusedError,
  UnknownDefectError,
  DefectRefusedError,
  MemoryRefusedError,
  UnknownMemoryError,
  UnknownSessionError,
  DomainRefusedError,
  UnknownDomainError,
  UnknownSecretError,
  SecretRefusedError,
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

/** What a client is told of a configuration that is not valid. */
const INVALID = `Each error is in errors, where it is. A ${CONFIG_FILE_NAME} that is not valid is corrected, then taken again: the revision in force stays as it is meanwhile.`;

/** What a client is told of an instance that has no configuration: the two ways to give it one. */
const NONE = `Write ${CONFIG_FILE_NAME} at the root of the test repository, or save a configuration made from the revision 0.`;

/** What a client is told of a source that takes no document: how one does. */
const NO_SOURCE = `Declare it in the configuration, of type document with "stored": true, and save it first.`;

/** What a client is told of documents that are refused. */
const INVALID_DOCUMENTS = "Each error is in errors, at the document it is about, in the order of the upload.";

/** What a client is told of a capture the run of a test it read did not attach. */
const NO_CAPTURE = "Read the test again with GET /tests/reading: each of its steps says whether it has a capture.";

/** What a client is told of a trace the run read did not keep. */
const NO_TRACE =
  "Read the test again with GET /tests/reading, which says whether that run kept one; a run keeps the trace of a test as its configuration of Playwright asks.";

/** What a client is told of a test the test repository does not hold. */
const NO_TEST = "List the tests of the repository with GET /tests: a test is named by its path and its titles as it gives them.";

/** What a client is told of a campaign the instance does not keep. */
const NO_CAMPAIGN = "List the campaigns it keeps with GET /campaigns.";

/** What a client is told of an execution the instance does not keep. */
const NO_EXECUTION = "List the executions it keeps with GET /executions.";
const NO_PROPOSAL = "List the tests to review with GET /reviews.";

/** What a client is told of a domain the knowledge does not hold. */
const NO_DOMAIN = "List its domains with GET /knowledge/domains.";

/** What a client is told of a variable the configuration in force does not name. */
const NO_SECRET = "List the variables it names with GET /secrets.";

/** The problem of a request the HTTP layer refused with a status: a malformed one is `invalid_request`, any other keeps its status. */
function refusalOf(status: number, detail: string): Problem {
  return status === HttpStatus.BAD_REQUEST ? problemOf("invalid_request", detail) : problemOf("error", detail, status);
}

/**
 * Reads an error as the problem a client is told, when the error is one the API expects.
 *
 * @remarks
 * These errors are expected: those the routes raise for a request they cannot read, the refusals of
 * the operations on sessions — a session that does not exist, one that ended, one that goes on and is resumed,
 * no test repository to run one in — and on the configuration — a stale revision, a file that changed too, a
 * configuration that is not valid, none at all — and on documents — a source that takes none, a document it does
 * not hold, an upload that is refused — and on the tests — a capture their run did not attach, a test the repository does not hold, a change that cannot be written — and on the executions
 * — one the instance does not keep, tests that cannot be launched now — and on the campaigns — one the instance does
 * not keep, a change its state does not allow — and on the domains of the knowledge — one it does not hold, a change or a session it refuses — and on the values of the variables — a variable the configuration does
 * not name, a value refused — a database that cannot be reached, those the framework raises for a request it refuses — an unknown
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
  if (error instanceof InvalidConfigurationError) return { ...problemOf("invalid_configuration", `${error.message} ${INVALID}`), errors: error.errors };
  if (error instanceof NoConfigurationError) return problemOf("no_configuration", `${error.message} ${NONE}`);
  if (error instanceof UnknownDocumentSourceError) return problemOf("unknown_document_source", `${error.message} ${NO_SOURCE}`);
  if (error instanceof UnknownDocumentError) return problemOf("unknown_document", error.message);
  if (error instanceof InvalidDocumentsError) return { ...problemOf("invalid_documents", `${error.message} ${INVALID_DOCUMENTS}`), errors: error.errors };
  if (error instanceof UnknownCaptureError) return problemOf("unknown_capture", `${error.message} ${NO_CAPTURE}`);
  if (error instanceof UnknownTraceError) return problemOf("unknown_trace", `${error.message} ${NO_TRACE}`);
  if (error instanceof UnknownTestError) return problemOf("unknown_test", `${error.message} ${NO_TEST}`);
  if (error instanceof TestChangeRefusedError) return problemOf("test_change_refused", error.message);
  if (error instanceof UnknownExecutionError) return problemOf("unknown_execution", `${error.message} ${NO_EXECUTION}`);
  if (error instanceof UnknownProposalError) return problemOf("unknown_proposal", `${error.message} ${NO_PROPOSAL}`);
  if (error instanceof ReviewRefusedError) return problemOf("review_refused", error.message);
  if (error instanceof UnknownDefectError) return problemOf("unknown_defect", `${error.message} List them with GET /defects.`);
  if (error instanceof DefectRefusedError) return problemOf("defect_refused", error.message);
  if (error instanceof UnknownMemoryError) return problemOf("unknown_memory", `${error.message} List them with GET /memory.`);
  if (error instanceof MemoryRefusedError) return problemOf("memory_refused", error.message);
  if (error instanceof LaunchRefusedError) return problemOf("launch_refused", error.message);
  if (error instanceof UnknownCampaignError) return problemOf("unknown_campaign", `${error.message} ${NO_CAMPAIGN}`);
  if (error instanceof CampaignRefusedError) return problemOf("campaign_refused", error.message);
  if (error instanceof UnknownDomainError) return problemOf("unknown_domain", `${error.message} ${NO_DOMAIN}`);
  if (error instanceof DomainRefusedError) return problemOf("domain_refused", error.message);
  if (error instanceof UnknownSecretError) return problemOf("unknown_secret", `${error.message} ${NO_SECRET}`);
  if (error instanceof SecretRefusedError) return problemOf("secret_refused", error.message);
  if (error instanceof DatabaseUnavailableError) return problemOf("unavailable", DATABASE_UNAVAILABLE);
  if (error instanceof HttpException) return refusalOf(error.getStatus(), error.message);
  if (!isRecord(error)) return undefined;
  const { statusCode, message } = error;
  if (typeof statusCode !== "number" || statusCode < 400 || statusCode > 499 || typeof message !== "string") return undefined;
  return refusalOf(statusCode, message);
}
