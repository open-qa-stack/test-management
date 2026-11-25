import type { ReactNode } from "react";
import { resultChange, type Execution, type ExecutionResult, type RepositoryTest, type ResultChange } from "@open-qa-stack/domain/sessions";
import { applicationName } from "../applications/application-names.ts";
import { durationText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { Badge, type BadgeTone } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { shownIn, type ExecutionView } from "./execution-view.ts";
import { resultHref } from "./executions-paths.ts";
import { FailureNote } from "./failure-note.tsx";
import { failuresFirst, VerdictBadge } from "./verdicts.tsx";

/** What an execution may change for a test, each with the tone of its badge, in the order a summary counts them. */
const CHANGES: Readonly<Record<ResultChange, BadgeTone>> = { new_failure: "ko", still_failing: "outline", fixed: "ok" };

/** What the execution changed for a test since its last run, as a badge; nothing when nothing changed. */
function changeBadge(result: ExecutionResult): ReactNode {
  const change = resultChange(result);
  return change === undefined ? null : <Badge tone={CHANGES[change]}>{t(`execution.change.${change}`)}</Badge>;
}

/** The domain of each test of an execution, as the test repository says it now. */
export type DomainOf = (result: ExecutionResult) => string | undefined;

/**
 * Finds the domain of a test.
 *
 * @param tests - The tests of the repository; none until they are read.
 * @returns What gives it, by the path and the title of the test.
 */
export function domainsOf(tests: readonly RepositoryTest[]): DomainOf {
  const domains = new Map(tests.map(({ path, title, domain }) => [JSON.stringify([path, title]), domain]));
  return ({ path, title }) => domains.get(JSON.stringify([path, title]));
}

/** Whether a test holds every word of a search, in its title, its path or its domain, case aside. */
function matches(result: ExecutionResult, domain: string | undefined, search: string): boolean {
  const text = [result.title, result.path, domain].join(" ").toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word));
}

/** A test of the execution, as a line that leads to what came of it: its verdict, what changed since its last run, its title and where it failed, its domain, how long it took. */
function ResultRow({
  execution,
  result,
  domain,
}: {
  readonly execution: Execution;
  readonly result: ExecutionResult;
  readonly domain: string | undefined;
}): ReactNode {
  return (
    <a className="row tests-row exec-result-line" href={resultHref(execution.id, result.path)}>
      <span>
        <VerdictBadge verdict={result.verdict} />
      </span>
      <span>{changeBadge(result)}</span>
      <div>
        <b>{result.title}</b>
        <FailureNote failure={result.failure} />
      </div>
      <span className="small muted">{domain}</span>
      <span className="exec-seconds small muted">{durationText(result.durationMs)}</span>
    </a>
  );
}

/** What the table of the tests of an execution is drawn from. */
export interface ExecutionResultsProps {
  readonly execution: Execution;
  readonly view: ExecutionView;
  /** The words the tests are narrowed to; none for every one. */
  readonly search: string;
  readonly domainOf: DomainOf;
}

/** The tests of the execution a view shows, narrowed to a search, as a table for each application in the order they first came, the failures first in each. */
export function ExecutionResults({ execution, view, search, domainOf }: ExecutionResultsProps): ReactNode {
  if (execution.results.length === 0) return <EmptyState title={t("execution.noTest")} />;
  const inView = shownIn(execution.results, view);
  if (inView.length === 0) return <EmptyState title={t("execution.noneInView")} />;
  const shown = inView.filter((result) => matches(result, domainOf(result), search));
  if (shown.length === 0) return <EmptyState title={t("execution.noMatch")} />;
  const projects = [...new Set(shown.map((result) => result.project))];
  return projects.map((project) => {
    const results = failuresFirst(shown.filter((result) => result.project === project));
    return (
      <Card key={project} title={applicationName(project)} hint={t("tests.count", { count: results.length })}>
        <div className="exec-result-line exec-result-head small muted" aria-hidden="true">
          <span>{t("execution.columns.result")}</span>
          <span>{t("execution.columns.change")}</span>
          <span>{t("execution.columns.test")}</span>
          <span>{t("execution.columns.domain")}</span>
          <span className="exec-seconds">{t("execution.columns.duration")}</span>
        </div>
        {results.map((result, rank) => (
          <ResultRow key={rank} execution={execution} result={result} domain={domainOf(result)} />
        ))}
      </Card>
    );
  });
}
