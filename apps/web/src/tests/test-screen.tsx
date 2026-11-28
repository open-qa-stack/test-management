import type { FormEventHandler, ReactNode } from "react";
import type { LaunchRequest, RepositoryTest, TestEdit, TestExecution, LastVerdict, TestVersion } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { resultHref } from "../executions/executions-paths.ts";
import { VerdictBadge } from "../executions/verdicts.tsx";
import { dateText, durationText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { levelName, originName, statusName } from "../i18n/vocabulary.ts";
import { applicationName } from "../applications/application-names.ts";
import { TechnicalDetails } from "../ui/technical-details.tsx";
import { hrefTo, withPanel, type Route } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { REPORT_PANEL, TESTS_PATH } from "./tests-paths.ts";
import { TestRelaunch, type RelaunchState } from "./test-relaunch.tsx";
import { TestCode } from "./test-code.tsx";
import { TestTree } from "./test-tree.tsx";
import { WhatToDo } from "./what-to-do.tsx";
import { DefectReportPanel, type DefectReporting } from "../defects/defect-report-panel.tsx";
import { TestSteps } from "./test-steps.tsx";
import { TestEditPanel } from "./test-edit-panel.tsx";
import type { TextSaving } from "./test-text-panel.tsx";

/** How many of the latest executions the summary of a test counts. */
export const HISTORY_SIZE = 10;

/** What the card of a test is drawn from. */
export interface TestScreenProps {
  /** The name of the project. */
  readonly project: string;
  /** The path of the test, as the address gives it. */
  readonly path: string;
  /** Where the console is, which tells the panel open: the title, or a step by its number. */
  readonly route: Route;
  /** What the instance told of the tests of the repository, among which this one. */
  readonly tests: PolledState<readonly RepositoryTest[]>;
  /** What the instance told of the executions of the test, the latest first. */
  readonly executions: PolledState<readonly TestExecution[]>;
  /** What came of the tests of the repository the last time each ran. */
  readonly verdicts?: readonly LastVerdict[];
  /** What the instance told of the versions of the test, the latest first. */
  readonly versions: PolledState<readonly TestVersion[]>;
  /** What the instance told of the text of the file of the test. */
  readonly source: PolledState<string>;
  /** Where the saving of a change to the test stands. */
  readonly saving: TextSaving;
  /** Changes the test: its own title, or the text of one of its steps. */
  readonly onChange: (test: RepositoryTest, edit: TestEdit) => void;
  /** Where its relaunch stands; none offers it. */
  readonly relaunch?: RelaunchState;
  /** Runs it again, against the environment chosen, if any. */
  readonly onRelaunch?: (where: Pick<LaunchRequest, "environment">) => void;
  /** Where the reporting of a defect of it stands. */
  readonly reporting?: DefectReporting;
  /** Reports a defect of it, from the form of its panel. */
  readonly onReport?: FormEventHandler<HTMLFormElement>;
}

/** What the tags of the test say of it: its level, its domain and functionality, its applications. */
function Tags({ test }: { readonly test: RepositoryTest }): ReactNode {
  const where = [test.domain, test.feature].filter((part) => part !== undefined).join(" › ");
  return (
    <div className="test-tags">
      {test.level !== undefined && <Badge tone="outline">{levelName(test.level)}</Badge>}
      {where !== "" && <Badge tone="outline">{where}</Badge>}
      {test.applications.map((application) => (
        <Badge key={application} tone="outline">
          {applicationName(application)}
        </Badge>
      ))}
    </div>
  );
}

/** What came of the test lately: its latest verdict and when, how many of its latest executions passed when there were several, and the way to the latest result. */
function Summary({ path, executions }: { readonly path: string; readonly executions: readonly TestExecution[] }): ReactNode {
  const [latest] = executions;
  if (latest === undefined)
    return (
      <Card>
        <EmptyState title={t("test.neverRun")}>{t("test.neverRunNote")}</EmptyState>
      </Card>
    );
  const recent = executions.slice(0, HISTORY_SIZE);
  const passed = recent.filter(({ result }) => result.verdict === "passed" || result.verdict === "flaky").length;
  return (
    <Card>
      <div className="row test-summary">
        <VerdictBadge verdict={latest.result.verdict} />
        <div className="grow">
          <b>{t("test.lastRun", { date: dateText(latest.ranAt) })}</b>
          {recent.length > 1 && <div className="small muted">{t("test.rate", { passed, count: recent.length })}</div>}
        </div>
        <span className="test-dots" role="img" aria-label={t("test.history")}>
          {recent.toReversed().map(({ id, result }, rank) => (
            <span key={`${id}-${rank}`} className={`test-dot ${result.verdict}`} title={statusName(result.verdict)} />
          ))}
        </span>
        <a className="btn" href={resultHref(latest.id, path)}>
          {t("test.lastResult")} →
        </a>
      </div>
    </Card>
  );
}

/**
 * The executions of the test, the latest first, each with the version of the test and the commit it ran at — said not
 * committed when the test differed from it —, leading to what came of the test there.
 */
function History({ path, title, executions }: { readonly path: string; readonly title: string; readonly executions: readonly TestExecution[] }): ReactNode {
  if (executions.length === 0) return null;
  return (
    <Card title={t("test.executions")} hint={t("test.executionsHint", { count: executions.length })}>
      {executions.map((execution, rank) => (
        <a key={`${execution.id}-${rank}`} className="row tests-row" href={resultHref(execution.id, path)}>
          <VerdictBadge verdict={execution.result.verdict} />
          <div className="grow">
            <b>{dateText(execution.ranAt)}</b>
            {execution.result.title !== title && <span className="small"> · {execution.result.title}</span>}
            <div className="small muted">
              {originName(execution.origin)}
              {execution.environment !== undefined && ` · ${execution.environment}`}
              {execution.result.version !== undefined && (
                <>
                  {" · "}
                  <span {...(execution.commit === undefined ? {} : { title: execution.commit.slice(0, 7) })}>
                    {t("test.versionShort", { number: execution.result.version })}
                  </span>
                </>
              )}
              {execution.result.committed === false && <> · {t("test.uncommitted")}</>}
            </div>
          </div>
          <span className="small muted">{durationText(execution.result.durationMs)}</span>
        </a>
      ))}
    </Card>
  );
}

/** The versions of the test, the latest first, each with the commit it was first run committed at, when it was. */
function Versions({ title, versions }: { readonly title: string; readonly versions: readonly TestVersion[] }): ReactNode {
  if (versions.length === 0) return null;
  return (
    <Card title={t("test.versions")} hint={t("test.versionsHint", { count: versions.length })}>
      {versions.map((version) => (
        <div key={`${version.title}-${version.number}`} className="row tests-row">
          <div className="grow">
            <b {...(version.commit === undefined ? {} : { title: version.commit.slice(0, 7) })}>{t("test.version", { number: version.number })}</b>
            {version.title !== title && <span className="small"> · {version.title}</span>}
            <div className="small muted">{t("test.versionSince", { date: dateText(version.since), count: version.executions })}</div>
          </div>
          {version.commit === undefined && (
            <span title={t("test.uncommittedNote")}>
              <Badge tone="outline">{t("test.uncommitted")}</Badge>
            </span>
          )}
        </div>
      ))}
    </Card>
  );
}

/**
 * The card of a test: what it is — its title, its path, what its tags say, its steps as written, its code, its versions
 * — and what came of it lately — its latest verdict, how many of its latest executions passed, and each of them, at the
 * version it ran, leading to what came of it there; what to do when it failed, and the tests of the repository by domain. Its title and the text of each of its steps are changed in a panel.
 *
 * @param props - The name of the project, the path of the test, the route, what the instance told, and what changes the test.
 * @returns The screen.
 */
export function TestScreen({
  project,
  path,
  route,
  tests,
  executions,
  verdicts = [],
  versions,
  source,
  saving,
  onChange,
  relaunch,
  onRelaunch,
  reporting = { pending: false },
  onReport,
}: TestScreenProps): ReactNode {
  const test = tests.value?.find((candidate) => candidate.path === path);
  const title = test?.title ?? path;
  const ran = executions.value;
  return (
    <Page
      crumbs={[{ label: project }, { label: t("tests.title"), href: hrefTo(TESTS_PATH) }, { label: title }]}
      title={title}
      {...(relaunch === undefined || onRelaunch === undefined ? {} : { actions: <TestRelaunch state={relaunch} onLaunch={onRelaunch} /> })}
    >
      {test !== undefined && (
        <div className="row test-head">
          <a className="btn sm" href={withPanel(route, "title")}>
            {t("test.editTitle")}
          </a>
        </div>
      )}
      {test !== undefined && <Tags test={test} />}
      {tests.value === undefined || ran === undefined ? (
        <EmptyState title={t("test.reading")}>
          <span role="status">{tests.unread ?? executions.unread ?? t("test.readingNote")}</span>
        </EmptyState>
      ) : (
        <>
          <Summary path={path} executions={ran} />
          <WhatToDo path={path} latest={ran[0]} {...(test === undefined ? {} : { report: withPanel(route, REPORT_PANEL) })} />
          {test === undefined && <EmptyState title={t("test.unknown")}>{t("test.unknownNote")}</EmptyState>}
          <div className="test-reading">
            <div className="test-column">
              {test !== undefined && <TestSteps test={test} editHref={(number) => withPanel(route, `step:${number}`)} />}
              <Versions title={title} versions={versions.value ?? []} />
            </div>
            <div className="test-column">
              <History path={path} title={title} executions={ran} />
              {test !== undefined && <TestCode source={source} />}
              <TestTree path={path} tests={tests.value} verdicts={verdicts} failing={route.query["tree"] === "failing"} />
            </div>
          </div>
          {test !== undefined && <TestEditPanel test={test} route={route} tests={tests.value} saving={saving} onChange={onChange} />}
          {test !== undefined && route.query["panel"] === REPORT_PANEL && ran[0]?.result.verdict === "failed" && (
            <DefectReportPanel
              title={test.title}
              latest={ran[0]}
              close={withPanel(route)}
              reporting={reporting}
              {...(onReport === undefined ? {} : { onSubmit: onReport })}
            />
          )}
        </>
      )}
      <TechnicalDetails>
        <span className="mono">{path}</span>
      </TechnicalDetails>
    </Page>
  );
}
