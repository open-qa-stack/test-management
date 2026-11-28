import type { ReactNode } from "react";
import type { QaView, TestReading } from "@open-qa-stack/domain/sessions";
import { API_BASE } from "../api/api-client.ts";
import type { PolledState } from "../api/polled-state.ts";
import { dateText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { statusName, type Status } from "../i18n/vocabulary.ts";
import { hrefTo } from "../routing/route.ts";
import { testHref } from "../tests/tests-paths.ts";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { EXECUTIONS_PATH, executionHref, traceHref } from "./executions-paths.ts";
import { Comparison, numbered, outcomeText, reportHref, StepRows, type NumberedStep, type Place } from "./test-run.tsx";

/** The address of the capture of a step in the run of an execution, as the instance serves it. */
function captureSrc(id: string, path: string, step: number): string {
  return `${API_BASE}/tests/capture?${new URLSearchParams({ path, step: String(step), execution: id }).toString()}`;
}

/** What the screen of what came of a test in an execution is drawn from. */
export interface ResultScreenProps {
  /** The name of the project. */
  readonly project: string;
  /** The identifier of the execution, as the address gives it. */
  readonly id: string;
  /** The path of the test, as the address gives it. */
  readonly path: string;
  /** The step whose page the address asks to show; the one that failed, or the last captured, by default. */
  readonly step?: number;
  /** What the instance told of the test in that execution. */
  readonly state: PolledState<TestReading>;
}

/**
 * The step whose page the screen shows: the one the address asks for when the test has it; otherwise the step that
 * failed, or else the last one captured, or else the first.
 */
function shownStep(view: QaView, asked: number | undefined): number | undefined {
  const steps = numbered(view);
  if (steps.some((step) => step.number === asked)) return asked;
  return view.failedStep ?? steps.findLast((step) => step.capture !== undefined)?.number ?? steps[0]?.number;
}

/**
 * The step before or after the one the screen shows.
 *
 * @param view - The test read in steps.
 * @param asked - The step the address asks to show.
 * @param by - How far: `-1` for the step before, `1` for the one after.
 * @returns Its number; `undefined` past the first or the last step.
 */
export function stepBeside(view: QaView, asked: number | undefined, by: -1 | 1): number | undefined {
  const steps = numbered(view);
  const shown = shownStep(view, asked);
  return steps[steps.findIndex((step) => step.number === shown) + by]?.number;
}

/** The status of each way Playwright says a test ended, as every screen names it. */
const STATUSES: Readonly<Record<QaView["status"], Status>> = { expected: "passed", unexpected: "failed", flaky: "flaky", skipped: "skipped" };

/**
 * How the test ended in the execution, at the head of the screen: where it failed and what it expected and received,
 * in the tone of the failure, or how it went through its steps; then its trace, the action a person takes first,
 * and the report of a defect when it failed.
 */
function Outcome({ view, place, traced }: { readonly view: QaView; readonly place: Place; readonly traced: boolean }): ReactNode {
  const failed = view.status === "unexpected";
  const tone = failed ? "ko" : view.status === "flaky" ? "warn" : view.status === "skipped" ? "neutral" : "ok";
  return (
    <section className={`run-outcome ${tone}`} aria-label={t("result.outcome")}>
      <header className="run-outcome-head">
        <Badge tone={tone}>{statusName(STATUSES[view.status])}</Badge>
        <b>{outcomeText(view)}</b>
      </header>
      {view.failedStep !== undefined && <Comparison expected={view.expected} received={view.received} />}
      {(traced || failed) && (
        <div className="run-outcome-actions">
          {traced && (
            <a className="btn primary" href={traceHref(place.id, place.path)}>
              {t("trace.openPlaywright")}
            </a>
          )}
          {failed && (
            <a className="btn" href={reportHref(place.path)}>
              {t("result.report")}
            </a>
          )}
        </div>
      )}
    </section>
  );
}

/** The page at a step, as the run captured it, whole width. */
function Screen({ step, place }: { readonly step: NumberedStep; readonly place: Place }): ReactNode {
  const src = captureSrc(place.id, place.path, step.number);
  return (
    <Card title={t("test.screenAt", { number: step.number })}>
      {step.capture === undefined ? (
        <p className="test-compare small muted">{t("test.noCapture")}</p>
      ) : (
        <>
          <img className="test-capture" src={src} alt={t("test.capture", { number: step.number })} />
          <a className="test-capture-open" href={src} target="_blank" rel="noopener">
            {t("result.enlarge")} ↗
          </a>
        </>
      )}
    </Card>
  );
}

/** What the reporter tells besides the steps, folded: the file of the test, the whole error, the stack, the outputs and the files the runner kept. */
function Details({ view, path }: { readonly view: QaView; readonly path: string }): ReactNode {
  const { error, stack, stdout, stderr, trace, errorContext } = view.details;
  const files = [path, ...[trace, errorContext, ...view.details.screenshots].filter((file) => file !== undefined)];
  return (
    <details className="test-details">
      <summary>{t("technicalDetails")}</summary>
      {error !== undefined && <pre className="mono">{error}</pre>}
      {stack !== undefined && <pre className="mono">{stack}</pre>}
      {[...stdout, ...stderr].length > 0 && <pre className="mono">{[...stdout, ...stderr].join("")}</pre>}
      <ul className="small mono">
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </details>
  );
}

/** The test read in steps: how it ended, what it expected and found, its steps, the page at one of them, and its details. */
function Reading({
  place,
  view,
  asked,
  traced,
}: {
  readonly place: Place;
  readonly view: QaView;
  readonly asked: number | undefined;
  readonly traced: boolean;
}): ReactNode {
  const steps = numbered(view);
  const shown = shownStep(view, asked);
  const step = steps.find((candidate) => candidate.number === shown);
  return (
    <>
      <Outcome view={view} place={place} traced={traced} />
      <div className="test-reading">
        <Card
          title={t("test.steps")}
          hint={t("tests.steps", { count: steps.length })}
          {...(steps.length > 1 ? { aside: <span className="keys small muted">{t("test.stepKeys")}</span> } : {})}
        >
          {steps.length === 0 && <EmptyState title={t("test.noStep")} />}
          <StepRows view={view} place={place} {...(shown === undefined ? {} : { shown })} />
        </Card>
        {step !== undefined && <Screen step={step} place={place} />}
      </div>
      <Details view={view} path={place.path} />
    </>
  );
}

/**
 * The screen of what came of a test in an execution, read as a person checks it: how it ended and where it failed,
 * what it expected and what it found, its trace to open first when its run kept one, its steps, and the page at one
 * of them, the one that failed by default, to enlarge; the mechanics folded. It leads to the card of the test, where
 * a defect of a failure is reported, and back to the execution.
 *
 * @param props - The name of the project, the execution and the path of the test, the step the address asks to show, and what the instance told.
 * @returns The screen.
 */
export function ResultScreen({ project, id, path, step, state }: ResultScreenProps): ReactNode {
  const reading = state.value;
  const title = reading?.view?.id.split(" › ").at(-1) ?? path;
  const ran = reading?.ranAt === undefined ? id : dateText(reading.ranAt);
  return (
    <Page
      crumbs={[{ label: project }, { label: t("executions.title"), href: hrefTo(EXECUTIONS_PATH) }, { label: ran, href: executionHref(id) }, { label: title }]}
      title={title}
    >
      <p className="small">
        <a href={testHref(path)}>{t("result.card")}</a>
      </p>
      {reading === undefined ? (
        <EmptyState title={t("test.reading")}>
          <span role="status">{state.unread ?? t("test.readingNote")}</span>
        </EmptyState>
      ) : reading.view === undefined ? (
        <EmptyState title={t("result.gone")}>{t("result.goneNote")}</EmptyState>
      ) : (
        <Reading place={{ id, path }} view={reading.view} asked={step} traced={reading.traced === true} />
      )}
    </Page>
  );
}
