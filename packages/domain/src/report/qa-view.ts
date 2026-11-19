import type { ReportedStatus } from "../test/reported-test.ts";
import { reportEntries, type JsonAttachment, type JsonResult, type JsonStep } from "./json-report.ts";

/** A capture a test attached during one of its steps, as the reporter keeps it. */
export interface QaCapture {
  /** Its name: the number of its step, as `testInfo.attach` names it in a test the harness writes. */
  readonly name: string;
  readonly contentType: string;
  /** Its file, as the runner wrote it; none for a capture the report holds itself. */
  readonly path?: string;
}

/** A step of a test, as a person reads it: a `test.step` the test calls, with those it holds. */
export interface QaStep {
  /** Its number, from 1, in the order of the report; none for a step another holds. */
  readonly number?: number;
  /** Its title, as the test writes it. */
  readonly title: string;
  readonly state: "passed" | "failed";
  /** How long it took, in milliseconds. */
  readonly duration: number;
  /** The capture the test attached for it; none when it attached none. */
  readonly capture?: QaCapture;
  /** The steps it holds, in their order. */
  readonly steps: readonly QaStep[];
}

/** What the reporter tells of a test besides its steps, for the one who looks at the mechanics. */
export interface QaDetails {
  /** The whole message of the error of the test, without colours; none for a test that passed. */
  readonly error?: string;
  readonly stack?: string;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
  /** The files the runner kept: its trace, the context of the error, the screenshots it took itself. */
  readonly trace?: string;
  readonly errorContext?: string;
  readonly screenshots: readonly string[];
}

/** A test of a report, read in steps: what it did, where it failed, what it expected and what it found. */
export interface QaView {
  /** The identifier the harness gives it, `<project> › <file>:<line> › … › <title>`. */
  readonly id: string;
  /** The status the reporter gives it; never the verdict of the harness, which this view does not change. */
  readonly status: ReportedStatus;
  /** Its steps, those of its last attempt. */
  readonly steps: readonly QaStep[];
  /** The number of the first step that failed, when one did. */
  readonly failedStep?: number;
  /** What the failed assertion expected and what it received, when its message says both. */
  readonly expected?: string;
  readonly received?: string;
  /** The numbers of the steps the test attached no capture for. */
  readonly uncaptured: readonly number[];
  readonly details: QaDetails;
}

/** The tests of a report read in steps, or why the report cannot be read. */
export type QaViews = { readonly views: readonly QaView[] } | { readonly unavailable: string };

/** The colours the runner writes in its messages. */
const COLOURS = /\u001b\[[0-9;]*m/g;

/**
 * Reads the tests of a JSON of the Playwright reporter in steps, as a person checks a test: the `test.step` it calls,
 * numbered, each with its state, its duration and its capture, where it failed, and what the failed assertion
 * expected and received.
 *
 * @remarks
 * It reads the report alone: no trace, no page, no model. A capture is that of a step when the test attached it under
 * the number of the step, as the tests the harness writes do; a step with none is told among `uncaptured`. The
 * expected and the received values come from the message of the error when it gives both, as `Expected: …` and
 * `Received: …` lines; otherwise neither is given, and the whole message stays in the details. Steps the test did not
 * reach are not in the report, and are not made up.
 *
 * @param json - The text of the report.
 * @returns Each test of the report, in its order; or why the report cannot be read, empty or of another form.
 */
export function qaViews(json: string): QaViews {
  const entries = reportEntries(json);
  if (entries === undefined) return { unavailable: json.trim() === "" ? "The report is empty." : "The report is no JSON of the Playwright reporter." };
  return { views: entries.map(({ id, test }) => viewOf(id, test.status, test.results.at(-1))) };
}

/** A test in steps, from its last attempt; none of its steps when it made no attempt. */
function viewOf(id: string, status: ReportedStatus, result: JsonResult | undefined): QaView {
  const attachments = result?.attachments ?? [];
  const steps = (result?.steps ?? []).map((step, at) => stepOf(step, attachments, at + 1));
  const failed = steps.find((step) => step.state === "failed")?.number;
  const [error] = result?.errors ?? [];
  const message = error?.message?.replace(COLOURS, "");
  const expected = message === undefined ? undefined : /^Expected[^:\n]*: (.*)$/m.exec(message)?.[1];
  const received = message === undefined ? undefined : /^Received[^:\n]*: (.*)$/m.exec(message)?.[1];
  const kept = (name: string) => attachments.find((attachment) => attachment.name === name)?.path;
  const trace = kept("trace");
  const errorContext = kept("error-context");
  return {
    id,
    status,
    steps,
    ...(failed === undefined ? {} : { failedStep: failed }),
    ...(expected === undefined || received === undefined ? {} : { expected, received }),
    uncaptured: steps.filter((step) => step.capture === undefined).map((step) => step.number!),
    details: {
      ...(message === undefined ? {} : { error: message }),
      ...(error?.stack === undefined ? {} : { stack: error.stack.replace(COLOURS, "") }),
      stdout: outputOf(result?.stdout),
      stderr: outputOf(result?.stderr),
      ...(trace === undefined ? {} : { trace }),
      ...(errorContext === undefined ? {} : { errorContext }),
      screenshots: attachments.flatMap((attachment) => (attachment.name === "screenshot" && attachment.path !== undefined ? [attachment.path] : [])),
    },
  };
}

/** A step, numbered when it is one the test calls, with the capture attached under its number and the steps it holds. */
function stepOf(step: JsonStep, attachments: readonly JsonAttachment[], number?: number): QaStep {
  const attached = number === undefined ? undefined : attachments.find((attachment) => attachment.name === String(number));
  return {
    ...(number === undefined ? {} : { number }),
    title: step.title,
    state: step.error === undefined ? "passed" : "failed",
    duration: step.duration ?? 0,
    ...(attached === undefined
      ? {}
      : {
          capture: {
            name: attached.name,
            contentType: attached.contentType ?? "application/octet-stream",
            ...(attached.path === undefined ? {} : { path: attached.path }),
          },
        }),
    steps: (step.steps ?? []).map((inner) => stepOf(inner, attachments)),
  };
}

/** What a test wrote to an output, chunk by chunk. */
function outputOf(chunks: JsonResult["stdout"]): string[] {
  return (chunks ?? []).flatMap((chunk) => {
    const text = typeof chunk === "string" ? chunk : chunk.text;
    return text === undefined ? [] : [text];
  });
}
