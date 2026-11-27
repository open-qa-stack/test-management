import { HttpStatus } from "@nestjs/common";
import type { Problem, ProblemCode } from "@open-qa-stack/domain/sessions";

/** What every problem of one code has in common. */
interface ProblemKind {
  /** The HTTP status it is answered with, unless the problem bears its own. */
  readonly status: number;
  readonly title: string;
}

const KINDS: Readonly<Record<ProblemCode, ProblemKind>> = {
  unknown_session: { status: HttpStatus.NOT_FOUND, title: "Unknown session" },
  invalid_request: { status: HttpStatus.BAD_REQUEST, title: "Invalid request" },
  session_running: { status: HttpStatus.CONFLICT, title: "A session is running" },
  session_ended: { status: HttpStatus.CONFLICT, title: "Session ended" },
  unavailable: { status: HttpStatus.SERVICE_UNAVAILABLE, title: "Sessions unavailable" },
  not_opened: { status: HttpStatus.BAD_GATEWAY, title: "Session not opened" },
  opening_timed_out: { status: HttpStatus.SERVICE_UNAVAILABLE, title: "Opening timed out" },
  stale_revision: { status: HttpStatus.CONFLICT, title: "Stale revision" },
  invalid_configuration: { status: HttpStatus.UNPROCESSABLE_ENTITY, title: "Invalid configuration" },
  no_configuration: { status: HttpStatus.NOT_FOUND, title: "No configuration" },
  unknown_document_source: { status: HttpStatus.NOT_FOUND, title: "Unknown source of documents" },
  unknown_document: { status: HttpStatus.NOT_FOUND, title: "Unknown document" },
  invalid_documents: { status: HttpStatus.UNPROCESSABLE_ENTITY, title: "Invalid documents" },
  unknown_capture: { status: HttpStatus.NOT_FOUND, title: "Unknown capture" },
  unknown_trace: { status: HttpStatus.NOT_FOUND, title: "Unknown trace" },
  unknown_test: { status: HttpStatus.NOT_FOUND, title: "Unknown test" },
  test_change_refused: { status: HttpStatus.UNPROCESSABLE_ENTITY, title: "Change refused" },
  unknown_execution: { status: HttpStatus.NOT_FOUND, title: "Unknown execution" },
  unknown_proposal: { status: HttpStatus.NOT_FOUND, title: "Unknown proposal" },
  review_refused: { status: HttpStatus.CONFLICT, title: "Review refused" },
  launch_refused: { status: HttpStatus.CONFLICT, title: "Launch refused" },
  unknown_campaign: { status: HttpStatus.NOT_FOUND, title: "Unknown campaign" },
  campaign_refused: { status: HttpStatus.CONFLICT, title: "Campaign refused" },
  unknown_domain: { status: HttpStatus.NOT_FOUND, title: "Unknown domain" },
  domain_refused: { status: HttpStatus.UNPROCESSABLE_ENTITY, title: "Domain refused" },
  unknown_secret: { status: HttpStatus.NOT_FOUND, title: "Unknown variable" },
  secret_refused: { status: HttpStatus.CONFLICT, title: "Value refused" },
  error: { status: HttpStatus.INTERNAL_SERVER_ERROR, title: "Request not answered" },
};

/**
 * Writes the body of an answer that is not a success.
 *
 * @remarks
 * The type and the title of a problem depend on its code alone, so that a client can rely on them: the type is
 * a reference relative to the root of the API, which stays the same behind any proxy.
 *
 * @param code - The code of the problem.
 * @param detail - What went wrong this time.
 * @param status - The HTTP status of the answer; that of the code when left out.
 * @returns The problem.
 */
export function problemOf(code: ProblemCode, detail: string, status: number = KINDS[code].status): Problem {
  return { type: `/problems/${code.replaceAll("_", "-")}`, title: KINDS[code].title, status, detail, code };
}
