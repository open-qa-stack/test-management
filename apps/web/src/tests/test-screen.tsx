import type { ReactNode } from "react";
import type { QaStep, QaView, TestReading } from "@open-qa-stack/domain/sessions";
import { API_BASE } from "../api/api-client.ts";
import { dateText, elapsedText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { hrefTo } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import type { TestState } from "./test-state.ts";
import { TESTS_PATH, testStepHref } from "./tests-paths.ts";

/** The address of the capture of a step, as the instance serves it. */
function captureSrc(path: string, step: number): string {
  return `${API_BASE}/tests/capture?${new URLSearchParams({ path, step: String(step) }).toString()}`;
}

/** What the screen of a test is drawn from. */
export interface TestScreenProps {
  /** The name of the project. */
  readonly project: string;
  /** The path of the test, as the address gives it. */
  readonly path: string;
  /** The step whose page the address asks to show; the one that failed, or the last captured, by default. */
  readonly step?: number;
  readonly state: TestState;
}

/** The numbered steps of a test: those it calls, in its order. */
const numbered = (view: QaView): readonly (QaStep & { readonly number: number })[] =>
  view.steps.filter((step): step is QaStep & { readonly number: number } => step.number !== undefined);

/**
 * The step whose page the screen shows: the one the address asks for when the test has it; otherwise the step that
 * failed, or else the last one captured, or else the first.
 */
function shownStep(view: QaView, asked: number | undefined): number | undefined {
  const steps = numbered(view);
  if (steps.some((step) => step.number === asked)) return asked;
  return view.failedStep ?? steps.findLast((step) => step.capture !== undefined)?.number ?? steps[0]?.number;
}

/** How the latest run of the test ended, in one sentence: where it failed, or in how many steps it went through. */
function Summary({ reading, view }: { readonly reading: TestReading; readonly view: QaView }): ReactNode {
  const count = numbered(view).length;
  const tone = view.status === "unexpected" ? "ko" : view.status === "flaky" ? "warn" : view.status === "skipped" ? "neutral" : "ok";
  const sentence = view.failedStep !== undefined ? t("test.summary.failedAt", { step: view.failedStep, count }) : t(`test.summary.${view.status}`, { count });
  return (
    <Card>
      <div className="row test-summary">
        <Badge tone={tone}>{t(`test.status.${view.status}`)}</Badge>
        <div className="grow">
          <b>{sentence}</b>
          <div className="small muted">
            {reading.ranAt === undefined ? t("test.ranIn", { run: reading.run }) : t("test.ranAt", { date: dateText(reading.ranAt) })}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** What the failed assertion expected and received, when its message says both. */
function Comparison({ view }: { readonly view: QaView }): ReactNode {
  if (view.failedStep === undefined) return null;
  return (
    <Card>
      {view.expected !== undefined && view.received !== undefined ? (
        <dl className="test-compare">
          <dt>{t("test.expected")}</dt>
          <dd className="mono">{view.expected}</dd>
          <dt>{t("test.received")}</dt>
          <dd className="mono">{view.received}</dd>
        </dl>
      ) : (
        <p className="test-compare small muted">{t("test.noCompare")}</p>
      )}
    </Card>
  );
}

/** A step of the test in the list: its number and state, its title and the steps it holds, its duration; it shows its page. */
function StepRow({ step, path, shown }: { readonly step: QaStep & { readonly number: number }; readonly path: string; readonly shown: boolean }): ReactNode {
  const failed = step.state === "failed";
  return (
    <a
      className={["row", "test-step", failed ? "failed" : "", shown ? "on" : ""].filter((name) => name !== "").join(" ")}
      href={testStepHref(path, step.number)}
      aria-current={shown ? "step" : undefined}
    >
      <span className="small muted test-step-number">{step.number}</span>
      <span className={failed ? "test-step-state ko" : "test-step-state ok"} role="img" aria-label={t(`test.states.${step.state}`)}>
        {failed ? "✕" : "✓"}
      </span>
      <div className="grow">
        <b>{step.title}</b>
        {step.steps.length > 0 && (
          <ul className="small muted test-substeps">
            {step.steps.map((inner, index) => (
              <li key={index}>{inner.title}</li>
            ))}
          </ul>
        )}
      </div>
      <span className="small muted">{elapsedText(step.duration)}</span>
    </a>
  );
}

/** The page at a step, as the run captured it, whole width. */
function Screen({ step, path }: { readonly step: QaStep & { readonly number: number }; readonly path: string }): ReactNode {
  return (
    <Card title={t("test.screenAt", { number: step.number })}>
      {step.capture === undefined ? (
        <p className="test-compare small muted">{t("test.noCapture")}</p>
      ) : (
        <img className="test-capture" src={captureSrc(path, step.number)} alt={t("test.capture", { number: step.number })} />
      )}
    </Card>
  );
}

/** What the reporter tells besides the steps, folded: the whole error, the stack, the outputs and the files the runner kept. */
function Details({ view }: { readonly view: QaView }): ReactNode {
  const { error, stack, stdout, stderr, trace, errorContext } = view.details;
  const files = [trace, errorContext, ...view.details.screenshots].filter((file) => file !== undefined);
  return (
    <details className="test-details">
      <summary>{t("test.details")}</summary>
      {error !== undefined && <pre className="mono">{error}</pre>}
      {stack !== undefined && <pre className="mono">{stack}</pre>}
      {[...stdout, ...stderr].length > 0 && <pre className="mono">{[...stdout, ...stderr].join("")}</pre>}
      {files.length > 0 && (
        <ul className="small mono">
          {files.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** The test read in steps, once a run ran it: how that run ended, what it expected and found, its steps, the page at one of them, and its details. */
function Reading({ reading, view, asked }: { readonly reading: TestReading; readonly view: QaView; readonly asked: number | undefined }): ReactNode {
  const steps = numbered(view);
  const shown = shownStep(view, asked);
  const step = steps.find((candidate) => candidate.number === shown);
  return (
    <>
      <Summary reading={reading} view={view} />
      <Comparison view={view} />
      <div className="test-reading">
        <Card title={t("test.steps")} hint={t("tests.steps", { count: steps.length })}>
          {steps.length === 0 && <EmptyState title={t("test.noStep")} />}
          {steps.map((candidate) => (
            <StepRow key={candidate.number} step={candidate} path={reading.path} shown={candidate.number === shown} />
          ))}
        </Card>
        {step !== undefined && <Screen step={step} path={reading.path} />}
      </div>
      <Details view={view} />
    </>
  );
}

/**
 * The screen of a test, read as a person checks it: how the latest run that ran it ended and where it failed, what
 * it expected and what it found, its steps, and the page at one of them, the one that failed by default; the
 * mechanics folded.
 *
 * @param props - The name of the project, the path of the test, the step the address asks to show, and what the instance told.
 * @returns The screen.
 */
export function TestScreen({ project, path, step, state }: TestScreenProps): ReactNode {
  const { reading } = state;
  const title = reading?.view?.id.split(" › ").at(-1) ?? path;
  return (
    <Page crumbs={[{ label: project }, { label: t("tests.title"), href: hrefTo(TESTS_PATH) }, { label: title }]} title={title}>
      <p className="small muted mono">{path}</p>
      {reading === undefined ? (
        <EmptyState title={t("test.reading")}>
          <span role="status">{state.unread ?? t("test.readingNote")}</span>
        </EmptyState>
      ) : reading.view === undefined ? (
        <EmptyState title={t("test.notRun")}>{t("test.notRunNote")}</EmptyState>
      ) : (
        <Reading reading={reading} view={reading.view} asked={step} />
      )}
    </Page>
  );
}
