import type { ReactNode } from "react";
import type { Execution, ExecutionResult, ExecutionVerdict } from "@open-qa-stack/domain/sessions";
import { dateText, durationText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { testHref } from "../tests/tests-paths.ts";
import { Badge, type BadgeTone } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import type { ExecutionsState } from "./executions-state.ts";

/** The verdicts, in the order the summary of an execution counts them, each with the tone of its badge. */
const VERDICTS: readonly (readonly [ExecutionVerdict, BadgeTone])[] = [
  ["passed", "ok"],
  ["failed", "ko"],
  ["flaky", "warn"],
  ["skipped", "neutral"],
];

/** The tone of the badge of a verdict. */
const toneOf = (verdict: ExecutionVerdict): BadgeTone => VERDICTS.find(([known]) => known === verdict)![1];

/** What the screen of the executions is drawn from. */
export interface ExecutionsScreenProps {
  /** The name of the project. */
  readonly project: string;
  readonly state: ExecutionsState;
}

/** A test of an execution, which leads to the screen of the test: its verdict, its title, its path, and how long it took. */
function ResultRow({ result }: { readonly result: ExecutionResult }): ReactNode {
  return (
    <a className="row tests-row" href={testHref(result.path)}>
      <Badge tone={toneOf(result.verdict)}>{t(`executions.verdicts.${result.verdict}`)}</Badge>
      <div className="grow">
        <b>{result.title}</b>
        <div className="small muted mono">{result.path}</div>
      </div>
      <span className="small muted">{durationText(result.durationMs)}</span>
    </a>
  );
}

/** How many tests of an execution came to each verdict, those none came to left out. */
function Summary({ results }: { readonly results: readonly ExecutionResult[] }): ReactNode {
  return VERDICTS.map(([verdict, tone]) => [verdict, tone, results.filter((result) => result.verdict === verdict).length] as const)
    .filter(([, , count]) => count > 0)
    .map(([verdict, tone, count]) => (
      <Badge key={verdict} tone={tone}>
        {t(`executions.counts.${verdict}`, { count })}
      </Badge>
    ));
}

/** An execution: when it ran, where it comes from, the version of the repository, then each of its tests. */
function ExecutionCard({ execution }: { readonly execution: Execution }): ReactNode {
  const hint = [
    t(`executions.origins.${execution.origin}`),
    execution.commit === undefined ? t("executions.noVersion") : t("executions.commit", { commit: execution.commit.slice(0, 7) }),
  ].join(" · ");
  return (
    <Card title={dateText(execution.ranAt)} hint={hint} aside={<Summary results={execution.results} />}>
      {execution.results.length === 0 ? (
        <p className="small muted">{t("executions.noTest")}</p>
      ) : (
        execution.results.map((result, rank) => <ResultRow key={rank} result={result} />)
      )}
    </Card>
  );
}

/**
 * The screen of the executions of tests the instance keeps: each execution, the latest first, with what came of each
 * of its tests, each leading to the screen of the test.
 *
 * @param props - The name of the project, and what the instance told.
 * @returns The screen.
 */
export function ExecutionsScreen({ project, state }: ExecutionsScreenProps): ReactNode {
  const title = t("executions.title");
  const { executions } = state;
  return (
    <Page crumbs={[{ label: project }, { label: title }]} title={title}>
      {executions === undefined ? (
        <EmptyState title={t("executions.reading")}>
          <span role="status">{state.unread ?? t("executions.readingNote")}</span>
        </EmptyState>
      ) : executions.length === 0 ? (
        <EmptyState title={t("executions.none")}>{t("executions.noneNote")}</EmptyState>
      ) : (
        <>
          <p className="small muted">{t("executions.lead", { count: executions.length })}</p>
          {executions.map((execution) => (
            <ExecutionCard key={execution.id} execution={execution} />
          ))}
        </>
      )}
    </Page>
  );
}
