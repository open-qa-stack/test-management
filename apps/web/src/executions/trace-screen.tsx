import type { ReactNode } from "react";
import type { TestReading } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { dateText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { hrefTo } from "../routing/route.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { EXECUTIONS_PATH, executionHref, resultHref, traceViewerSrc } from "./executions-paths.ts";

/** What the screen of the trace of a test in an execution is drawn from. */
export interface TraceScreenProps {
  /** The name of the project. */
  readonly project: string;
  /** The identifier of the execution, as the address gives it. */
  readonly id: string;
  /** The path of the test, as the address gives it. */
  readonly path: string;
  /** What the instance told of the test in that execution, which says whether its run kept a trace. */
  readonly state: PolledState<TestReading>;
}

/**
 * The trace of a test in an execution, in the trace viewer of Playwright as the instance serves it, over the whole
 * page: the timeline of the test, its actions, the page before and after each, the network, the console. It leads
 * back to what came of the test there, and opens the viewer in a tab of its own.
 *
 * @param props - The name of the project, the execution and the path of the test, and what the instance told.
 * @returns The screen.
 */
export function TraceScreen({ project, id, path, state }: TraceScreenProps): ReactNode {
  const reading = state.value;
  const title = reading?.view?.id.split(" › ").at(-1) ?? path;
  const ran = reading?.ranAt === undefined ? id : dateText(reading.ranAt);
  const src = traceViewerSrc(id, path);
  return (
    <Page
      crumbs={[
        { label: project },
        { label: t("executions.title"), href: hrefTo(EXECUTIONS_PATH) },
        { label: ran, href: executionHref(id) },
        { label: t("trace.title") },
      ]}
      title={t("trace.title")}
      {...(reading?.traced === true
        ? {
            actions: (
              <a className="btn" href={src} target="_blank" rel="noopener">
                {t("trace.newTab")} ↗
              </a>
            ),
          }
        : {})}
    >
      <p className="small">
        <a href={resultHref(id, path)}>← {title}</a>
      </p>
      {reading === undefined ? (
        <EmptyState title={t("test.reading")}>
          <span role="status">{state.unread ?? t("test.readingNote")}</span>
        </EmptyState>
      ) : reading.traced === true ? (
        <iframe className="trace-frame" src={src} title={t("trace.frame", { title })} />
      ) : (
        <EmptyState title={t("trace.none")} action={<a href={resultHref(id, path)}>{t("trace.back")}</a>}>
          {t("trace.noneNote")}
        </EmptyState>
      )}
    </Page>
  );
}
