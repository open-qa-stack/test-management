import type { FormEventHandler, ReactNode } from "react";
import type { Execution, ExecutionResult, LaunchRequest, RepositoryTest, Session } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { dateText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { TechnicalDetails } from "../ui/technical-details.tsx";
import { hrefTo } from "../routing/route.ts";
import { TestRelaunch, type RelaunchState } from "../tests/test-relaunch.tsx";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { domainsOf, ExecutionResults } from "./execution-results.tsx";
import { ExecutionTiles } from "./execution-tiles.tsx";
import { requestOf } from "./execution-text.ts";
import { EXECUTION_VIEWS, openingView, shownIn, type ExecutionView } from "./execution-view.ts";
import { EXECUTIONS_PATH, executionHref } from "./executions-paths.ts";
import { campaignHref } from "../campaigns/campaigns-paths.ts";

/** What the screen of an execution is drawn from. */
export interface ExecutionScreenProps {
  /** The name of the project. */
  readonly project: string;
  /** The identifier of the execution, as the address gives it. */
  readonly id: string;
  /** The sessions of the project the console listed, which name the one that ran the execution. */
  readonly sessions: readonly Session[];
  /** Which of its tests the address asks to show; those it opens on by default. */
  readonly view?: ExecutionView;
  /** The words the address narrows its tests to. */
  readonly search?: string;
  /** Narrows its tests to the words of the search form. */
  readonly onSearch?: FormEventHandler<HTMLFormElement>;
  /** The tests of the repository, which tell the domain of each; none until they are read. */
  readonly tests?: readonly RepositoryTest[];
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

/** Whether none of the tests the execution ran had run before, against its environment, as far as the instance knows. */
const isFirst = ({ results }: Execution): boolean => results.length > 0 && results.every(({ previous }) => previous === undefined);

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

/** The environments to choose from, that of the execution first, as long as the configuration declares it. */
const firstOf = (environment: string | undefined, declared: readonly string[]): readonly string[] =>
  declared.toSorted((left, right) => Number(right === environment) - Number(left === environment));

/** The views of the execution, each with how many tests it shows, the one shown marked. */
function Views({ execution, shown, search }: { readonly execution: Execution; readonly shown: ExecutionView; readonly search: string }): ReactNode {
  return (
    <nav className="exec-views" aria-label={t("execution.views.label")}>
      {EXECUTION_VIEWS.map((view) => (
        <a
          key={view}
          className={view === shown ? "chip on" : "chip"}
          href={executionHref(execution.id, view, search)}
          aria-current={view === shown ? "page" : undefined}
        >
          {t(`execution.views.${view}`)} · {shownIn(execution.results, view).length}
        </a>
      ))}
    </nav>
  );
}

/**
 * The screen of an execution: the figures of its tests, against which environment, where it comes from and at which version,
 * then its tests, those to look at first, or those of another view, narrowed to the words of a search, each leading to what came of it; the files of those that failed run again on demand.
 *
 * @param props - The name of the project, the identifier of the execution, the sessions, and what the instance told.
 * @returns The screen.
 */
export function ExecutionScreen({
  project,
  id,
  sessions,
  view,
  search = "",
  onSearch,
  tests = [],
  state,
  relaunch,
  onRelaunch,
}: ExecutionScreenProps): ReactNode {
  const execution = state.value;
  const shown = view ?? openingView(execution?.results ?? []);
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
          <ExecutionTiles execution={execution} />
          <Card>
            <div className="row exec-summary">
              {execution.environment !== undefined && <Badge tone="outline">{execution.environment}</Badge>}
              {isFirst(execution) && <span className="small">{t("execution.first")}</span>}
              <Origin execution={execution} sessions={sessions} />
            </div>
          </Card>
          {execution.results.length > 0 && (
            <>
              <Views execution={execution} shown={shown} search={search} />
              <form className="tests-search" role="search" onSubmit={onSearch}>
                <input type="search" name="q" defaultValue={search} aria-label={t("execution.search")} placeholder={t("execution.search")} />
              </form>
            </>
          )}
          <ExecutionResults execution={execution} view={shown} search={search} domainOf={domainsOf(tests)} />
          <TechnicalDetails>
            {execution.commit === undefined ? t("execution.noVersion") : t("execution.version", { commit: execution.commit.slice(0, 7) })}
          </TechnicalDetails>
        </>
      )}
    </Page>
  );
}
