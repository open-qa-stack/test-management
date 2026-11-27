import { isRecord } from "../json.ts";

/** How serious a defect is, from the one that blocks to the cosmetic one. */
export const DEFECT_SEVERITIES = ["S1", "S2", "S3", "S4"] as const;

/** How serious a defect is. */
export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];

/** Where a defect stands, as a person moves it: to deal with, fixed, or closed. */
export type DefectStatus = "open" | "fixed" | "closed";

/** The longest title of a defect, in characters. */
export const MAX_DEFECT_TITLE = 200;

/** The longest description of a defect, in characters. */
export const MAX_DEFECT_DESCRIPTION = 10_000;

/** The test a defect was reported from. */
export interface DefectTest {
  /** The path of its file, relative to the root of the test repository. */
  readonly path: string;
  /** Its titles, as `<describe>… › <title>`. */
  readonly title: string;
}

/** A defect a person reported from a test that failed, as the instance keeps it. */
export interface Defect {
  /** Its reference, `D-` and its number. */
  readonly id: string;
  readonly title: string;
  readonly severity: DefectSeverity;
  /** What the person wrote of it, as Markdown. */
  readonly description: string;
  readonly test: DefectTest;
  /** The execution whose failure it was reported from, when it was. */
  readonly execution?: string;
  readonly status: DefectStatus;
  /** When it was reported, as an ISO 8601 date. */
  readonly openedAt: string;
  /** When it was marked fixed, as an ISO 8601 date, while it is. */
  readonly fixedAt?: string;
  /** When it was closed, as an ISO 8601 date, while it is. */
  readonly closedAt?: string;
}

/**
 * Where a defect stands for the person who follows it: to deal with, fixed and its test to run again, fixed and its test
 * passed since, or closed.
 */
export type DefectStage = "open" | "to_replay" | "replayed" | "closed";

/** A defect, with where it stands for the person who follows it. */
export interface ListedDefect extends Defect {
  readonly stage: DefectStage;
}

/** The defects of the instance, the latest reported first, and how many each view holds. */
export interface DefectList {
  readonly items: readonly ListedDefect[];
  /** Those to deal with, those fixed whose test is to run again, and those closed or whose test passed since they were fixed. */
  readonly counts: { readonly open: number; readonly toReplay: number; readonly closed: number };
}

/** What a person reports of a test that failed. */
export interface DefectReport {
  readonly title: string;
  readonly severity: DefectSeverity;
  readonly description: string;
  readonly test: DefectTest;
  readonly execution?: string;
}

/** A text trimmed, when it is one that is not empty once trimmed. */
function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * Reads what a person reports of a test, as a client sends it.
 *
 * @param value - The body: `{ title, severity, description?, test: { path, title }, execution? }`.
 * @returns The report; or why it is refused, in a sentence.
 */
export function defectReportOf(value: unknown): DefectReport | string {
  if (!isRecord(value)) return "A defect is { title, severity, description, test: { path, title }, execution }.";
  const title = textOf(value["title"]);
  if (title === undefined || title.length > MAX_DEFECT_TITLE) return `The title of a defect is a text of 1 to ${MAX_DEFECT_TITLE} characters.`;
  const severity = DEFECT_SEVERITIES.find((known) => known === value["severity"]);
  if (severity === undefined) return `The severity of a defect is one of ${DEFECT_SEVERITIES.join(", ")}.`;
  const description = textOf(value["description"]) ?? "";
  if (description.length > MAX_DEFECT_DESCRIPTION) return `The description of a defect is ${MAX_DEFECT_DESCRIPTION} characters at most.`;
  const test = value["test"];
  const path = isRecord(test) ? textOf(test["path"]) : undefined;
  const named = isRecord(test) ? textOf(test["title"]) : undefined;
  if (path === undefined || named === undefined) return "A defect names the test it is reported from: { path, title }.";
  const execution = textOf(value["execution"]);
  return { title, severity, description, test: { path, title: named }, ...(execution === undefined ? {} : { execution }) };
}

/**
 * Reads where a person moves a defect, as a client sends it.
 *
 * @param value - The body: `{ status }`, one of `open`, `fixed` and `closed`.
 * @returns The change; or why it is refused, in a sentence.
 */
export function defectStatusOf(value: unknown): { readonly status: DefectStatus } | string {
  const status = isRecord(value) ? value["status"] : undefined;
  return status === "open" || status === "fixed" || status === "closed"
    ? { status }
    : 'A change of a defect is { "status" }, one of "open", "fixed" and "closed".';
}
