import type { ReactNode } from "react";
import type { RepositoryTest, TestExecution } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { resultHref } from "../executions/executions-paths.ts";
import { versionText } from "../executions/execution-text.ts";
import { VerdictBadge } from "../executions/verdicts.tsx";
import { dateText, durationText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { hrefTo } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { TESTS_PATH } from "./tests-paths.ts";
import { levelText } from "./tests-screen.tsx";

/** How many of the latest executions the summary of a test counts. */
export const HISTORY_SIZE = 10;

/** What the card of a test is drawn from. */
export interface TestScreenProps {
  /** The name of the project. */
  readonly project: string;
  /** The path of the test, as the address gives it. */
  readonly path: string;
  /** What the instance told of the tests of the repository, among which this one. */
  readonly tests: PolledState<readonly RepositoryTest[]>;
  /** What the instance told of the executions of the test, the latest first. */
  readonly executions: PolledState<readonly TestExecution[]>;
}

/** What the tags of the test say of it: its level, its domain and functionality, its applications. */
function Tags({ test }: { readonly test: RepositoryTest }): ReactNode {
  const where = [test.domain, test.feature].filter((part) => part !== undefined).join(" › ");
  return (
    <div className="test-tags">
      {test.level !== undefined && <Badge tone="outline">{levelText(test.level)}</Badge>}
      {where !== "" && <Badge tone="outline">{where}</Badge>}
      {test.applications.map((application) => (
        <Badge key={application} tone="outline">
          {application}
        </Badge>
      ))}
    </div>
  );
}

/** What came of the test lately: its latest verdict and when, how many of its latest executions passed, and the way to the latest result. */
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
          <div className="small muted">{t("test.rate", { passed, count: recent.length })}</div>
        </div>
        <span className="test-dots" role="img" aria-label={t("test.history")}>
          {recent.toReversed().map(({ id, result }, rank) => (
            <span key={`${id}-${rank}`} className={`test-dot ${result.verdict}`} title={t(`executions.verdicts.${result.verdict}`)} />
          ))}
        </span>
        <a className="btn" href={resultHref(latest.id, path)}>
          {t("test.lastResult")} →
        </a>
      </div>
    </Card>
  );
}

/** The steps of the test as its file writes them, without what came of them. */
function Description({ test }: { readonly test: RepositoryTest }): ReactNode {
  return (
    <Card title={t("test.description")} hint={t("test.written", { count: test.steps.length })}>
      {test.steps.length === 0 ? (
        <p className="test-compare small muted">{t("test.noWrittenStep")}</p>
      ) : (
        <ul className="test-written">
          {test.steps.map((step, rank) => (
            <li key={rank}>{step}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The executions of the test, the latest first, each leading to what came of the test there. */
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
              {t(`executions.origins.${execution.origin}`)} · <span className="mono">{versionText(execution)}</span>
            </div>
          </div>
          <span className="small muted">{durationText(execution.result.durationMs)}</span>
        </a>
      ))}
    </Card>
  );
}

/**
 * The card of a test: what it is — its title, its path, what its tags say, its steps as written — and what came of
 * it lately — its latest verdict, how many of its latest executions passed, and each of them, leading to what came
 * of it there.
 *
 * @param props - The name of the project, the path of the test, and what the instance told.
 * @returns The screen.
 */
export function TestScreen({ project, path, tests, executions }: TestScreenProps): ReactNode {
  const test = tests.value?.find((candidate) => candidate.path === path);
  const title = test?.title ?? path;
  const ran = executions.value;
  return (
    <Page crumbs={[{ label: project }, { label: t("tests.title"), href: hrefTo(TESTS_PATH) }, { label: title }]} title={title}>
      <p className="small muted mono">{path}</p>
      {test !== undefined && <Tags test={test} />}
      {tests.value === undefined || ran === undefined ? (
        <EmptyState title={t("test.reading")}>
          <span role="status">{tests.unread ?? executions.unread ?? t("test.readingNote")}</span>
        </EmptyState>
      ) : (
        <>
          <Summary path={path} executions={ran} />
          {test === undefined && <EmptyState title={t("test.unknown")}>{t("test.unknownNote")}</EmptyState>}
          <div className="test-reading">
            {test !== undefined && <Description test={test} />}
            <History path={path} title={title} executions={ran} />
          </div>
        </>
      )}
    </Page>
  );
}
