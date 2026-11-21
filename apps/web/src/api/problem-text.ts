import type { ProblemCode } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";

/** The problems the console words: the API writes its details for a developer, not for the person. */
const WORDED: ReadonlySet<string> = new Set<Exclude<ProblemCode, "error">>([
  "unknown_session",
  "invalid_request",
  "session_running",
  "session_ended",
  "unavailable",
  "not_opened",
  "opening_timed_out",
  "stale_revision",
  "configuration_conflict",
  "invalid_configuration",
  "no_configuration",
  "unknown_document_source",
  "unknown_document",
  "invalid_documents",
  "unknown_capture",
  "unknown_trace",
  "unknown_execution",
  "launch_refused",
  "unknown_campaign",
  "campaign_refused",
  "unknown_secret",
  "secret_refused",
]);

/**
 * Reads the code of a problem.
 *
 * @param code - What the answer carries as its code, if anything.
 * @returns The code when the console knows it; `error` for none, and for one a later version of the API added.
 */
export function problemCode(code: unknown): ProblemCode {
  return typeof code === "string" && WORDED.has(code) ? (code as ProblemCode) : "error";
}

/**
 * Words a problem for the person.
 *
 * @param code - The code of the problem.
 * @param detail - What the API says went wrong, when it says it.
 * @returns The wording of the console for a code it knows, the detail of the API otherwise, or a sentence that
 * says no more than that the instance failed.
 */
export function problemText(code: ProblemCode, detail: unknown): string {
  if (code !== "error") return t(`problems.${code}`);
  return typeof detail === "string" && detail !== "" ? detail : t("problems.unexplained");
}
