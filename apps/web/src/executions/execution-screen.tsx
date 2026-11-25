import type { ReactNode } from "react";
import { resultChange, type Execution, type ExecutionResult, type LaunchRequest, type ResultChange, type Session } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { dateText, durationText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { applicationName } from "../applications/application-names.ts";
import { TechnicalDetails } from "../ui/technical-details.tsx";
import { hrefTo } from "../routing/route.ts";
import { TestRelaunch, type RelaunchState } from "../tests/test-relaunch.tsx";
import { Badge, type BadgeTone } from "../ui/badge.tsx";
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
  /** Where the relaunch of its failures stands. */
  readonly relaunch: RelaunchState;
  /** Runs its failures again, against the environment chosen, if any. */
  readonly onRelaunch: (where: Pick<LaunchRequest, "environment">) => void;
}

/** The tests of the execution that failed. */
const failuresOf = (execution: Execution): readonly ExecutionResult[] => execution.results.filter(({ verdict }) => verdict === "failed");

/**
 * The files of the tests an execution saw fail, each once.
 *
 * @param execution - The execution, once the instance told it.
 * @returns Their paths; none before that.
 */
export function failedPaths(execution: Execution | undefined): readonly string[] {
  return execution === undefined ? [] : [...new Set(failuresOf(execution).map(({ path }) => path))];
}

/** Where the execution comes from. */
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
    </div>
  );
}

/** What an execution may change for a test, each with the tone of its badge, in the order a summary counts them. */
const CHANGES: Readonly<Record<ResultChange, BadgeTone>> = { new_failure: "ko", still_failing: "outline", fixed: "ok" };

/** What the execution changed for a test since its last run, as a badge; nothing when nothing changed. */
function ChangeBadge({ result }: { readonly result: ExecutionResult }): ReactNode {
  const change = resultChange(result);
  return change === undefined ? null : <Badge tone={CHANGES[change]}>{t(`execution.change.${change}`)}</Badge>;
}

/** How many tests the execution changed, change by change, each against its last run; nothing when it changed none. */
function Changes({ results }: { readonly results: readonly ExecutionResult[] }): ReactNode {
  const told = (Object.keys(CHANGES) as ResultChange[])
    .map((change) => [change, results.filter((result) => resultChange(result) === change).length] as const)
    .filter(([, count]) => count > 0)
    .map(([change, count]) => t(`execution.changes.${change}`, { count }));
  return told.length === 0 ? null : <span className="small">{t("execution.since", { changes: told.join(", ") })}</span>;
}

/** The environments to choose from, that of the execution first, as long as the configuration declares it. */
const firstOf = (environment: string | undefined, declared: readonly string[]): readonly string[] =>
  declared.toSorted((left, right) => Number(right === environment) - Number(left === environment));

/** A test of the execution, which leads to what came of it: its verdict, what changed since its last run, its title, where it failed, and how long it took. */
function ResultRow({ execution, result }: { readonly execution: Execution; readonly result: ExecutionResult }): ReactNode {
  return (
    <a className="row tests-row" href={resultHref(execution.id, result.path)}>
      <VerdictBadge verdict={result.verdict} />
      <ChangeBadge result={result} />
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
      <Card key={project} title={applicationName(project)} hint={t("tests.count", { count: results.length })}>
        {results.map((result, rank) => (
          <ResultRow key={rank} execution={execution} result={result} />
        ))}
      </Card>
    );
  });
}

/**
 * The screen of an execution: what came of its tests, against which environment, what changed since the last run of each, how long it took, where it comes from and at which version,
 * then its tests, each leading to what came of it; the files of those that failed run again on demand.
 *
 * @param props - The name of the project, the identifier of the execution, the sessions, and what the instance told.
 * @returns The screen.
 */
export function ExecutionScreen({ project, id, sessions, state, relaunch, onRelaunch }: ExecutionScreenProps): ReactNode {
  const execution = state.value;
  // The failures of a campaign are launched from it, so that their execution belongs to it.
  const failures = execution === undefined || execution.campaignId !== undefined ? 0 : failuresOf(execution).length;
  const several = { label: t("execution.relaunch", { count: failures }), note: t("execution.relaunchNote") };
  const title = execution === undefined ? id : t("execution.title", { date: dateText(execution.ranAt) });
  return (
    <Page
      crumbs={[
        { label: project },
        { label: t("executions.title"), href: hrefTo(EXECUTIONS_PATH) },
        { label: execution === undefined ? id : dateText(execution.ranAt) },
      ]}
      title={title}
      {...(failures === 0
        ? {}
        : {
            actions: (
              <TestRelaunch
                state={{ ...relaunch, environments: firstOf(execution?.environment, relaunch.environments) }}
                onLaunch={onRelaunch}
                several={several}
              />
            ),
          })}
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
              {execution.environment !== undefined && <Badge tone="outline">{execution.environment}</Badge>}
              <Changes results={execution.results} />
              <span className="small">{t("execution.duration", { duration: executionDuration(execution) })}</span>
              <Origin execution={execution} sessions={sessions} />
            </div>
          </Card>
          <Results execution={execution} />
          <TechnicalDetails>
            {execution.commit === undefined ? t("execution.noVersion") : t("execution.version", { commit: execution.commit.slice(0, 7) })}
          </TechnicalDetails>
        </>
      )}
    </Page>
  );
}
