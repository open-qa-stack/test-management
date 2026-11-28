import type { ReactNode } from "react";
import type { QaView, TestReading } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { dateText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import type { Route } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { CopyButton } from "../ui/copy-button.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Icon } from "../ui/icon.tsx";
import { resultHref, traceHref, traceViewerSrc } from "./executions-paths.ts";
import { Comparison, outcomeText, reportHref, StepRows, type Place } from "./test-run.tsx";

/** What the screen of the trace of a test in an execution is drawn from. */
export interface TraceScreenProps {
  /** Where the console is: its address tells whether the context of the test is hidden. */
  readonly route: Route;
  /** The identifier of the execution, as the address gives it. */
  readonly id: string;
  /** The path of the test, as the address gives it. */
  readonly path: string;
  /** What the instance told of the test in that execution, which says whether its run kept a trace. */
  readonly state: PolledState<TestReading>;
}

/** What a person needs beside the trace: what the test expected and received, its steps, and the report of a defect when it failed. */
function Context({ view, place }: { readonly view: QaView; readonly place: Place }): ReactNode {
  return (
    <aside className="trace-context" aria-label={t("trace.context")}>
      {view.failedStep !== undefined && (
        <section className="trace-context-part">
          <h2>{t("trace.expectation")}</h2>
          <Comparison view={view} />
        </section>
      )}
      <section className="trace-context-part trace-context-steps">
        <h2>{t("trace.steps")}</h2>
        <StepRows view={view} place={place} />
      </section>
      {view.status === "unexpected" && (
        <div className="trace-context-actions">
          <a className="btn" href={reportHref(place.path)}>
            {t("result.report")}
          </a>
        </div>
      )}
    </aside>
  );
}

/**
 * What a phone shows in place of the trace viewer, which does not fit its width: why, the way back to the result,
 * which holds what a decision needs, the link of the trace to copy and open on a computer, and the viewer anyway.
 */
function OnPhone({ place, view, src }: { readonly place: Place; readonly view: QaView | undefined; readonly src: string }): ReactNode {
  return (
    <section className="trace-phone">
      <h2>{t("trace.phone.title")}</h2>
      <p className="muted">{t("trace.phone.note")}</p>
      <a className="trace-phone-back" href={resultHref(place.id, place.path)}>
        <span className="grow">
          <b>{t("trace.back")}</b>
          {view !== undefined && <span className="small muted">{outcomeText(view)}</span>}
        </span>
        <Icon name="chevron" />
      </a>
      <CopyButton text={traceHref(place.id, place.path)} label={t("trace.phone.copy")} link primary />
      <a className="btn" href={src}>
        {t("trace.phone.anyway")}
      </a>
      <p className="small muted">{t("trace.phone.link")}</p>
    </section>
  );
}

/**
 * The trace of a test in an execution, over the whole window: a bar leads back to what came of the test, names it,
 * its execution and how it ended, shows or hides the context of the test, and opens the trace viewer in a tab of its
 * own. Under it, from a tablet, the trace viewer of Playwright as the instance serves it, as it is, beside the
 * context of the test unless the address hides it (`?context=hidden`). A phone gets no viewer: it is led back to
 * the result.
 *
 * @param props - The route, the execution and the path of the test, and what the instance told.
 * @returns The screen.
 */
export function TraceScreen({ route, id, path, state }: TraceScreenProps): ReactNode {
  const place = { id, path };
  const reading = state.value;
  const view = reading?.view;
  const title = view?.id.split(" › ").at(-1) ?? path;
  const src = traceViewerSrc(id, path);
  const traced = reading?.traced === true;
  const context = route.query["context"] !== "hidden";
  return (
    <div className={context ? "trace-screen" : "trace-screen without-context"}>
      <header className="trace-bar">
        <a className="trace-bar-back" href={resultHref(id, path)} aria-label={t("trace.back")}>
          <Icon name="collapse" />
          <span>{t("trace.result")}</span>
        </a>
        <div className="trace-bar-title">
          <h1 tabIndex={-1}>{t("trace.heading", { title })}</h1>
          <p>{reading?.ranAt === undefined ? id : t("trace.ran", { date: dateText(reading.ranAt) })}</p>
        </div>
        {view?.failedStep !== undefined && <Badge tone="ko">{t("trace.failedAt", { step: view.failedStep })}</Badge>}
        {traced && view !== undefined && (
          <a
            className={context ? "btn sm primary trace-bar-context" : "btn sm trace-bar-context"}
            href={context ? traceHref(id, path, "hidden") : traceHref(id, path)}
            aria-pressed={context}
          >
            {t("trace.context")}
          </a>
        )}
        {traced && (
          <a className="btn sm trace-bar-tab" href={src} target="_blank" rel="noopener">
            {t("trace.newTab")} ↗
          </a>
        )}
      </header>
      {reading === undefined ? (
        <EmptyState title={t("test.reading")}>
          <span role="status">{state.unread ?? t("test.readingNote")}</span>
        </EmptyState>
      ) : traced ? (
        <div className="trace-body">
          <iframe className="trace-frame" src={src} title={t("trace.frame", { title })} loading="lazy" />
          {context && view !== undefined && <Context view={view} place={place} />}
          <OnPhone place={place} view={view} src={src} />
        </div>
      ) : (
        <EmptyState title={t("trace.none")} action={<a href={resultHref(id, path)}>{t("trace.back")}</a>}>
          {t("trace.noneNote")}
        </EmptyState>
      )}
    </div>
  );
}
