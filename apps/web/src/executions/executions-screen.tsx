import type { ChangeEventHandler, ReactNode } from "react";
import {
  EXECUTION_ORIGINS,
  type CampaignOverview,
  type Execution,
  type ExecutionList,
  type ExecutionOutcome,
  type ExecutionResult,
  type Session,
  type TestLaunch,
} from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { dateText, durationText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { originName } from "../i18n/vocabulary.ts";
import { applicationName } from "../applications/application-names.ts";
import { Badge } from "../ui/badge.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { campaignHref } from "../campaigns/campaigns-paths.ts";
import { hrefTo } from "../routing/route.ts";
import { LaunchAdvance } from "./launch-advance.tsx";
import { contentText, environmentText, executionDuration, launchOrigin, launchText } from "./execution-text.ts";
import { EXECUTION_PERIODS } from "./execution-period.ts";
import { EXECUTIONS_SIZES, executionHref, executionsHref, resultHref, RUNNING_PATH, type ExecutionsFilter } from "./executions-paths.ts";
import { FailureNote } from "./failure-note.tsx";
import { failuresFirst, VerdictBadge, VerdictBar } from "./verdicts.tsx";

/** The outcomes a person narrows the executions to. */
const OUTCOMES: readonly ExecutionOutcome[] = ["failing", "passing"];

/** What the person does on the screen of the executions: narrow them to an outcome, to an origin, to a campaign or to a period, and choose how many a page holds. */
export interface ExecutionsControls {
  readonly outcome: ChangeEventHandler<HTMLSelectElement>;
  readonly origin: ChangeEventHandler<HTMLSelectElement>;
  readonly campaign: ChangeEventHandler<HTMLSelectElement>;
  readonly size: ChangeEventHandler<HTMLSelectElement>;
  readonly period: ChangeEventHandler<HTMLSelectElement>;
}

/** What the screen of the executions is drawn from. */
export interface ExecutionsScreenProps {
  /** The name of the project. */
  readonly project: string;
  /** What the address narrows the executions to. */
  readonly filter: ExecutionsFilter;
  /** The execution the page starts after, as the address gives it. */
  readonly before?: string;
  /** The sessions of the project the console listed, which name what an execution ran. */
  readonly sessions: readonly Session[];
  /** The campaigns of the project the console listed, which name the one an execution was launched for; none until they are read. */
  readonly campaigns?: readonly CampaignOverview[];
  /** What the instance told of the page. */
  readonly state: PolledState<ExecutionList>;
  readonly controls: ExecutionsControls;
  /** The launch of tests that runs, when one does. */
  readonly running?: TestLaunch;
}

/** Whether a page shows a launch that runs: the first one, narrowed to nothing the launch is not; what comes of its tests is not known yet. */
function showsRunning({ campaign }: TestLaunch, filter: ExecutionsFilter, before: string | undefined): boolean {
  return (
    before === undefined &&
    filter.outcome === undefined &&
    (filter.origin ?? launchOrigin(campaign)) === launchOrigin(campaign) &&
    (filter.campaign === undefined || filter.campaign === campaign)
  );
}

/** The launch of tests that runs, which leads to its screen: when it started, where from, against which environment, and how far it went. */
function Running({ launch, campaigns }: { readonly launch: TestLaunch; readonly campaigns: readonly CampaignOverview[] }): ReactNode {
  return (
    <a className="card row exec-running" href={hrefTo(RUNNING_PATH)}>
      <Badge tone="info">{t("running.badge")}</Badge>
      <div className="grow">
        <b>{dateText(launch.startedAt)}</b>
        <div className="small muted">{launchText(launch, campaigns)}</div>
      </div>
      <LaunchAdvance launch={launch} />
    </a>
  );
}

/** The lists that narrow the executions to an outcome, to an origin, to a campaign when there is one, and to a period, every one first, the one chosen selected, then how many a page holds. */
function Filters({
  filter,
  controls,
  campaigns,
}: {
  readonly filter: ExecutionsFilter;
  readonly controls: ExecutionsControls;
  readonly campaigns: readonly CampaignOverview[];
}): ReactNode {
  return (
    <div className="exec-filters">
      <label className="exec-filter small">
        <span className="muted">{t("executions.outcomeFilter")}</span>
        <select value={filter.outcome ?? ""} onChange={controls.outcome}>
          <option value="">{t("executions.outcomes.all")}</option>
          {OUTCOMES.map((outcome) => (
            <option key={outcome} value={outcome}>
              {t(`executions.outcomes.${outcome}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="exec-filter small">
        <span className="muted">{t("executions.columns.origin")}</span>
        <select value={filter.origin ?? ""} onChange={controls.origin}>
          <option value="">{t("executions.allOrigins")}</option>
          {EXECUTION_ORIGINS.map((origin) => (
            <option key={origin} value={origin}>
              {originName(origin)}
            </option>
          ))}
        </select>
      </label>
      {campaigns.length > 0 && (
        <label className="exec-filter small">
          <span className="muted">{t("executions.campaignFilter")}</span>
          <select value={filter.campaign ?? ""} onChange={controls.campaign}>
            <option value="">{t("executions.allCampaigns")}</option>
            {campaigns.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="exec-filter small">
        <span className="muted">{t("executions.periodFilter")}</span>
        <select value={filter.period ?? ""} onChange={controls.period}>
          <option value="">{t("executions.periods.all")}</option>
          {EXECUTION_PERIODS.map((period) => (
            <option key={period} value={period}>
              {t(`executions.periods.${period}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="exec-filter small">
        <span className="muted">{t("executions.sizeFilter")}</span>
        <select value={filter.size ?? ""} onChange={controls.size}>
          {EXECUTIONS_SIZES.map((size, rank) => (
            <option key={size} value={rank === 0 ? "" : size}>
              {size}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** A test of an execution, which leads to what came of it there: its verdict, its title, its application, where it failed, and how long it took. */
function ResultRow({ execution, result }: { readonly execution: Execution; readonly result: ExecutionResult }): ReactNode {
  return (
    <a className="row tests-row" href={resultHref(execution.id, result.path)}>
      <VerdictBadge verdict={result.verdict} />
      <div className="grow">
        <b>{result.title}</b>
        <span className="small muted"> · {applicationName(result.project)}</span>
        <FailureNote failure={result.failure} />
      </div>
      <span className="small muted">{durationText(result.durationMs)}</span>
    </a>
  );
}

/** An execution, as a line that unfolds into its tests: when it ran, where from, what it ran and against which environment, what came of it, how long, at which version. */
function ExecutionRow({
  execution,
  sessions,
  campaigns,
}: {
  readonly execution: Execution;
  readonly sessions: readonly Session[];
  readonly campaigns: readonly CampaignOverview[];
}): ReactNode {
  const content = contentText(execution, sessions, campaigns);
  const where = environmentText(execution, campaigns);
  return (
    <details className="exec-row">
      <summary className="exec-line">
        <span className="exec-toggle" aria-hidden="true" />
        <a className="exec-date" href={executionHref(execution.id)}>
          {dateText(execution.ranAt)}
        </a>
        <span className="exec-origin">
          <Badge tone="neutral">{originName(execution.origin)}</Badge>
        </span>
        <span className="exec-content small">
          {execution.campaignId === undefined ? content : <a href={campaignHref(execution.campaignId)}>{content}</a>}
          {where !== undefined && <span className="muted"> · {where}</span>}
        </span>
        <span className="exec-result small">
          <VerdictBar results={execution.results} />
        </span>
        <span className="exec-duration small muted">{executionDuration(execution)}</span>
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

/** The executions of the page as a table whose lines unfold, then which of them it shows and the links to the latest ones and to the older ones. */
function Table({
  page,
  filter,
  before,
  sessions,
  campaigns,
}: {
  readonly page: ExecutionList;
  readonly filter: ExecutionsFilter;
  readonly before: string | undefined;
  readonly sessions: readonly Session[];
  readonly campaigns: readonly CampaignOverview[];
}): ReactNode {
  return (
    <>
      <section className="card exec-table">
        <div className="exec-line exec-head muted" aria-hidden="true">
          <span className="exec-toggle-room" />
          <span className="exec-date small">{t("executions.columns.date")}</span>
          <span className="exec-origin small">{t("executions.columns.origin")}</span>
          <span className="exec-content small">{t("executions.columns.content")}</span>
          <span className="exec-result small">{t("executions.columns.result")}</span>
          <span className="exec-duration small">{t("executions.columns.duration")}</span>
        </div>
        {page.items.map((execution) => (
          <ExecutionRow key={execution.id} execution={execution} sessions={sessions} campaigns={campaigns} />
        ))}
      </section>
      <nav className="exec-pages" aria-label={t("executions.pages")}>
        <span className="exec-range small muted">
          {t("executions.range", { first: page.start + 1, last: page.start + page.items.length, total: page.total })}
        </span>
        {before !== undefined && (
          <a className="btn" href={executionsHref(filter)}>
            ← {t("executions.newest")}
          </a>
        )}
        {page.next !== undefined && (
          <a className="btn" href={executionsHref(filter, page.next)}>
            {t("executions.older")} →
          </a>
        )}
      </nav>
    </>
  );
}

/**
 * The screen of the executions of tests the instance keeps: a page of them, the latest first, narrowed to an outcome,
 * an origin, a campaign and a period the address keeps, the launch that runs first, each a line that unfolds into its tests and leads to its screen.
 *
 * @param props - The name of the project, the filter and the page the address asks for, the sessions, what the instance told, and what the person does.
 * @returns The screen.
 */
export function ExecutionsScreen({ project, filter, before, sessions, campaigns = [], state, controls, running }: ExecutionsScreenProps): ReactNode {
  const title = t("executions.title");
  const page = state.value;
  const narrowed =
    filter.outcome !== undefined || filter.origin !== undefined || filter.campaign !== undefined || filter.period !== undefined || before !== undefined;
  const launch = running !== undefined && showsRunning(running, filter, before) && <Running launch={running} campaigns={campaigns} />;
  return (
    <Page
      crumbs={[{ label: project }, { label: title }]}
      title={title}
      {...(page === undefined || (page.items.length === 0 && !narrowed) ? {} : { hint: t("executions.lead") })}
    >
      {page === undefined ? (
        <EmptyState title={t("executions.reading")}>
          <span role="status">{state.unread ?? t("executions.readingNote")}</span>
        </EmptyState>
      ) : page.items.length === 0 && !narrowed ? (
        launch || <EmptyState title={t("executions.none")}>{t("executions.noneNote")}</EmptyState>
      ) : (
        <>
          <Filters filter={filter} controls={controls} campaigns={campaigns} />
          {launch}
          {page.items.length === 0 ? (
            <EmptyState title={t("executions.noMatch")}>{t("executions.noMatchNote")}</EmptyState>
          ) : (
            <Table page={page} filter={filter} before={before} sessions={sessions} campaigns={campaigns} />
          )}
        </>
      )}
    </Page>
  );
}
