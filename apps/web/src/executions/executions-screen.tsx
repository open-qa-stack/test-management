import type { ReactNode } from "react";
import type { Execution, ExecutionList, ExecutionOutcome, ExecutionResult, Session } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { dateText, durationText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { Badge } from "../ui/badge.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { contentText, executionDuration, versionText } from "./execution-text.ts";
import { executionHref, executionsHref, resultHref } from "./executions-paths.ts";
import { failuresFirst, VerdictBadge, VerdictCounts } from "./verdicts.tsx";

/** The outcomes a person narrows the executions to, every one first. */
const OUTCOMES: readonly (ExecutionOutcome | undefined)[] = [undefined, "failing", "passing"];

/** What the screen of the executions is drawn from. */
export interface ExecutionsScreenProps {
  /** The name of the project. */
  readonly project: string;
  /** The outcome the address narrows the executions to. */
  readonly outcome?: ExecutionOutcome;
  /** The execution the page starts after, as the address gives it. */
  readonly before?: string;
  /** The sessions of the project the console listed, which name what an execution ran. */
  readonly sessions: readonly Session[];
  /** What the instance told of the page. */
  readonly state: PolledState<ExecutionList>;
}

/** The links that narrow the executions to an outcome, the one chosen marked. */
function OutcomeFilter({ outcome }: { readonly outcome: ExecutionOutcome | undefined }): ReactNode {
  return (
    <nav className="tests-levels" aria-label={t("executions.outcomeFilter")}>
      {OUTCOMES.map((candidate) => (
        <a
          key={candidate ?? "all"}
          className={candidate === outcome ? "chip on" : "chip"}
          href={executionsHref(candidate)}
          aria-current={candidate === outcome ? "page" : undefined}
        >
          {t(`executions.outcomes.${candidate ?? "all"}`)}
        </a>
      ))}
    </nav>
  );
}

/** A test of an execution, which leads to what came of it there: its verdict, its title, its application, and how long it took. */
function ResultRow({ execution, result }: { readonly execution: Execution; readonly result: ExecutionResult }): ReactNode {
  return (
    <a className="row tests-row" href={resultHref(execution.id, result.path)}>
      <VerdictBadge verdict={result.verdict} />
      <div className="grow">
        <b>{result.title}</b>
        <span className="small muted"> · {result.project}</span>
      </div>
      <span className="small muted">{durationText(result.durationMs)}</span>
    </a>
  );
}

/** An execution, as a line that unfolds into its tests: when it ran, where from, what it ran, what came of it, how long, at which version. */
function ExecutionRow({ execution, sessions }: { readonly execution: Execution; readonly sessions: readonly Session[] }): ReactNode {
  return (
    <details className="exec-row">
      <summary className="exec-line">
        <a className="exec-date" href={executionHref(execution.id)}>
          {dateText(execution.ranAt)}
        </a>
        <span className="exec-origin">
          <Badge tone="neutral">{t(`executions.origins.${execution.origin}`)}</Badge>
        </span>
        <span className="exec-content small">{contentText(execution, sessions)}</span>
        <span className="exec-result">
          <VerdictCounts results={execution.results} />
        </span>
        <span className="exec-duration small muted">{executionDuration(execution)}</span>
        <span className="exec-version small muted mono">{versionText(execution)}</span>
      </summary>
      <div className="exec-tests">
        {execution.results.length === 0 ? (
          <p className="small muted">{t("execution.noTest")}</p>
        ) : (
          failuresFirst(execution.results).map((result, rank) => <ResultRow key={rank} execution={execution} result={result} />)
        )}
        <a className="small" href={executionHref(execution.id)}>
          {t("executions.open")} →
        </a>
      </div>
    </details>
  );
}

/** The executions of the page as a table whose lines unfold, then the links to the latest ones and to the older ones. */
function Table({
  page,
  outcome,
  before,
  sessions,
}: {
  readonly page: ExecutionList;
  readonly outcome: ExecutionOutcome | undefined;
  readonly before: string | undefined;
  readonly sessions: readonly Session[];
}): ReactNode {
  return (
    <>
      <section className="card exec-table">
        <div className="exec-line exec-head small muted" aria-hidden="true">
          <span className="exec-date">{t("executions.columns.date")}</span>
          <span className="exec-origin">{t("executions.columns.origin")}</span>
          <span className="exec-content">{t("executions.columns.content")}</span>
          <span className="exec-result">{t("executions.columns.result")}</span>
          <span className="exec-duration">{t("executions.columns.duration")}</span>
          <span className="exec-version">{t("executions.columns.version")}</span>
        </div>
        {page.items.map((execution) => (
          <ExecutionRow key={execution.id} execution={execution} sessions={sessions} />
        ))}
      </section>
      {(before !== undefined || page.next !== undefined) && (
        <nav className="exec-pages" aria-label={t("executions.pages")}>
          {before !== undefined && (
            <a className="btn" href={executionsHref(outcome)}>
              ← {t("executions.newest")}
            </a>
          )}
          {page.next !== undefined && (
            <a className="btn" href={executionsHref(outcome, page.next)}>
              {t("executions.older")} →
            </a>
          )}
        </nav>
      )}
    </>
  );
}

/**
 * The screen of the executions of tests the instance keeps: a page of them, the latest first, narrowed to an outcome
 * the address keeps, each a line that unfolds into its tests and leads to its screen.
 *
 * @param props - The name of the project, the outcome and the page the address asks for, the sessions, and what the instance told.
 * @returns The screen.
 */
export function ExecutionsScreen({ project, outcome, before, sessions, state }: ExecutionsScreenProps): ReactNode {
  const title = t("executions.title");
  const page = state.value;
  return (
    <Page crumbs={[{ label: project }, { label: title }]} title={title}>
      {page === undefined ? (
        <EmptyState title={t("executions.reading")}>
          <span role="status">{state.unread ?? t("executions.readingNote")}</span>
        </EmptyState>
      ) : page.items.length === 0 && outcome === undefined && before === undefined ? (
        <EmptyState title={t("executions.none")}>{t("executions.noneNote")}</EmptyState>
      ) : (
        <>
          <p className="small muted">{t("executions.lead")}</p>
          <OutcomeFilter outcome={outcome} />
          {page.items.length === 0 ? (
            <EmptyState title={t("executions.noMatch")}>{t("executions.noMatchNote")}</EmptyState>
          ) : (
            <Table page={page} outcome={outcome} before={before} sessions={sessions} />
          )}
        </>
      )}
    </Page>
  );
}
