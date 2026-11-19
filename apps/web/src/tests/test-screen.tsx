import type { ReactNode } from "react";
import type { QaStep, QaView, TestReading } from "@open-qa-stack/domain/sessions";
import { API_BASE } from "../api/api-client.ts";
import { elapsedText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { hrefTo } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import type { TestState } from "./test-state.ts";
import { TESTS_PATH } from "./tests-paths.ts";

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
  readonly state: TestState;
}

/** What the reporter tells of the run of the test, in the words of the person. */
function statusText(view: QaView): string {
  return t(`test.status.${view.status}`);
}

/** A step of the test: its number and title, its state and duration, its capture, and the steps it holds. */
function StepRow({ step, path, failed }: { readonly step: QaStep; readonly path: string; readonly failed: boolean }): ReactNode {
  return (
    <div className={failed ? "row test-step failed" : "row test-step"}>
      <div className="grow">
        <b>{step.title}</b>
        {step.steps.length > 0 && (
          <ul className="small muted test-substeps">
            {step.steps.map((inner, index) => (
              <li key={index}>{inner.title}</li>
            ))}
          </ul>
        )}
        {step.capture !== undefined && step.number !== undefined ? (
          <img className="test-capture" src={captureSrc(path, step.number)} alt={t("test.capture", { number: step.number })} loading="lazy" />
        ) : (
          <div className="small muted">{t("test.noCapture")}</div>
        )}
      </div>
      <Badge tone={step.state === "failed" ? "ko" : "ok"}>{t(`test.states.${step.state}`)}</Badge>
      <span className="small muted">{elapsedText(step.duration)}</span>
    </div>
  );
}

/** Where the test failed, and what its failed assertion expected and received when its message says both. */
function Failure({ view }: { readonly view: QaView }): ReactNode {
  if (view.failedStep === undefined) return null;
  return (
    <Card title={t("test.failedAt", { number: view.failedStep })}>
      {view.expected !== undefined && view.received !== undefined ? (
        <dl className="test-compare">
          <dt>{t("test.expected")}</dt>
          <dd className="mono">{view.expected}</dd>
          <dt>{t("test.received")}</dt>
          <dd className="mono">{view.received}</dd>
        </dl>
      ) : (
        <p className="small muted">{t("test.noCompare")}</p>
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

/** The test read in steps, once a run ran it: how that run ended, where it failed, its steps and its details. */
function Reading({ reading, view }: { readonly reading: TestReading; readonly view: QaView }): ReactNode {
  return (
    <>
      <p className="small muted">{t("test.lead", { run: reading.run, status: statusText(view) })}</p>
      <Failure view={view} />
      <Card title={t("test.steps")} hint={t("tests.steps", { count: view.steps.length })}>
        {view.steps.length === 0 && <EmptyState title={t("test.noStep")} />}
        {view.steps.map((step) => (
          <StepRow key={step.number} step={step} path={reading.path} failed={step.number === view.failedStep} />
        ))}
      </Card>
      <Details view={view} />
    </>
  );
}

/**
 * The screen of a test, read as a person checks it: the steps the latest run that ran it went through, each with its
 * state, its duration and its capture, where it failed, what it expected and what it found; the mechanics folded.
 *
 * @param props - The name of the project, the path of the test, and what the instance told.
 * @returns The screen.
 */
export function TestScreen({ project, path, state }: TestScreenProps): ReactNode {
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
        <Reading reading={reading} view={reading.view} />
      )}
    </Page>
  );
}
