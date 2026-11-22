import type { ReactNode } from "react";
import type { Execution, ExecutionResult, Session } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { dateText, durationText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { hrefTo } from "../routing/route.ts";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { executionDuration, requestOf } from "./execution-text.ts";
import { EXECUTIONS_PATH, resultHref } from "./executions-paths.ts";
import { FailureNote } from "./failure-note.tsx";
import { failuresFirst, VerdictBadge, VerdictCounts } from "./verdicts.tsx";
import { campaignHref } from "../campaigns/campaigns-paths.ts";

/** What the screen of an execution is drawn from. */
export interface ExecutionScreenProps {
  /** The name of the project. */
  readonly project: string;
  /** The identifier of the execution, as the address gives it. */
  readonly id: string;
  /** The sessions of the project the console listed, which name the one that ran the execution. */
  readonly sessions: readonly Session[];
  /** What the instance told of the execution. */
  readonly state: PolledState<Execution>;
}

/** Where the execution comes from, and the version of the test repository it ran at. */
function Origin({ execution, sessions }: { readonly execution: Execution; readonly sessions: readonly Session[] }): ReactNode {
  const request = requestOf(execution, sessions);
  return (
    <div className="grow small muted">
      {execution.campaignId !== undefined ? (
        <a href={campaignHref(execution.campaignId)}>{t("execution.forCampaign")}</a>
      ) : execution.origin === "manual" ? (
        <div>{t("execution.manual")}</div>
      ) : execution.sessionId === undefined ? (
        <div>{t("execution.noSession")}</div>
      ) : (
        <div>
          {request === undefined ? t("execution.bySession") : t("execution.launchedBy", { request })}{" "}
          <a href={hrefTo(`/agent/sessions/${execution.sessionId}`)}>{t("execution.seeSession")}</a>
        </div>
      )}
      <div>{execution.commit === undefined ? t("execution.noVersion") : t("execution.version", { commit: execution.commit.slice(0, 7) })}</div>
    </div>
  );
}

/** A test of the execution, which leads to what came of it: its verdict, its title, where it failed, and how long it took. */
function ResultRow({ execution, result }: { readonly execution: Execution; readonly result: ExecutionResult }): ReactNode {
  return (
    <a className="row tests-row" href={resultHref(execution.id, result.path)}>
      <VerdictBadge verdict={result.verdict} />
      <div className="grow">
        <b>{result.title}</b>
        <FailureNote failure={result.failure} />
      </div>
      <span className="small muted">{durationText(result.durationMs)}</span>
    </a>
  );
}

/** The tests of the execution, application by application in the order they first came, the failures first in each. */
function Results({ execution }: { readonly execution: Execution }): ReactNode {
  if (execution.results.length === 0) return <EmptyState title={t("execution.noTest")} />;
  const projects = [...new Set(execution.results.map((result) => result.project))];
  return projects.map((project) => {
    const results = failuresFirst(execution.results.filter((result) => result.project === project));
    return (
      <Card key={project} title={project} hint={t("tests.count", { count: results.length })}>
        {results.map((result, rank) => (
          <ResultRow key={rank} execution={execution} result={result} />
        ))}
      </Card>
    );
  });
}

/**
 * The screen of an execution: what came of its tests, how long it took, where it comes from and at which version,
 * then its tests, each leading to what came of it.
 *
 * @param props - The name of the project, the identifier of the execution, the sessions, and what the instance told.
 * @returns The screen.
 */
export function ExecutionScreen({ project, id, sessions, state }: ExecutionScreenProps): ReactNode {
  const execution = state.value;
  const title = execution === undefined ? id : t("execution.title", { date: dateText(execution.ranAt) });
  return (
    <Page
      crumbs={[
        { label: project },
        { label: t("executions.title"), href: hrefTo(EXECUTIONS_PATH) },
        { label: execution === undefined ? id : dateText(execution.ranAt) },
      ]}
      title={title}
    >
      {execution === undefined ? (
        <EmptyState title={t("execution.reading")}>
          <span role="status">{state.unread ?? t("execution.readingNote")}</span>
        </EmptyState>
      ) : (
        <>
          <Card>
            <div className="row exec-summary">
              <span className="exec-counts">
                <VerdictCounts results={execution.results} />
              </span>
              <span className="small">{t("execution.duration", { duration: executionDuration(execution) })}</span>
              <Origin execution={execution} sessions={sessions} />
            </div>
          </Card>
          <Results execution={execution} />
        </>
      )}
    </Page>
  );
}
