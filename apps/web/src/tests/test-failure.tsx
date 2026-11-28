import type { ReactNode } from "react";
import type { TestExecution } from "@open-qa-stack/domain/sessions";
import { agentHref } from "../agent/agent-paths.ts";
import { resultHref } from "../executions/executions-paths.ts";
import { Comparison } from "../executions/test-run.tsx";
import { dateText, durationText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { originName } from "../i18n/vocabulary.ts";
import { Icon } from "../ui/icon.tsx";

/** What is asked of the agent for a test that failed: to find why and to repair it, with its path and where it failed. */
function requestFor(path: string, { result: { title, failure } }: TestExecution): string {
  const step = failure?.step === undefined ? "" : t("test.todo.atStep", failure.step);
  return t("test.todo.request", { title, path, step });
}

/** When and where the test failed last, in a line: its date, how long it took, what ran it, the environment and the version. */
function factsOf(latest: TestExecution): string {
  const { result } = latest;
  return [
    dateText(latest.ranAt),
    durationText(result.durationMs),
    originName(latest.origin),
    ...(latest.environment === undefined ? [] : [latest.environment]),
    ...(result.version === undefined ? [] : [t("test.versionShort", { number: result.version })]),
  ].join(" · ");
}

/** What the failure card of a test needs. */
export interface TestFailureProps {
  /** The path of the test. */
  readonly path: string;
  /** How many steps its file writes, which the step it failed at is counted out of. */
  readonly steps: number;
  /** Its latest execution. */
  readonly latest: TestExecution | undefined;
  /** The link to the panel that reports a defect of it. */
  readonly report?: string;
}

/**
 * The card a test whose last run failed opens on, in the tone of the failure: the step it failed at, when and where,
 * the way to that result, what its assertion expected and received side by side, or else the first line of its
 * error, then what to do — the agent to ask, whose request is written for the person to send, and the defect to report.
 *
 * @param props - The path of the test, how many steps it writes, its latest execution, and the link that reports a defect of it.
 * @returns The card; nothing for a test whose last run did not fail.
 */
export function TestFailure({ path, steps, latest, report }: TestFailureProps): ReactNode {
  if (latest?.result.verdict !== "failed") return null;
  const { failure } = latest.result;
  return (
    <section className="run-outcome ko test-failure" aria-label={t("test.failure.label")}>
      <header className="run-outcome-head">
        <span className="tests-mark failed" aria-hidden="true">
          <Icon name="close" size={12} />
        </span>
        <b>{failure?.step === undefined ? t("test.failure.failed") : t("test.failure.atStep", { step: failure.step.number, count: steps })}</b>
        <span className="small muted grow">{factsOf(latest)}</span>
        <a href={resultHref(latest.id, path)}>{t("test.lastResult")}</a>
      </header>
      {failure?.expected !== undefined && failure.received !== undefined ? (
        <Comparison expected={failure.expected} received={failure.received} />
      ) : (
        failure?.message !== undefined && <p className="mono small test-failure-note">{failure.message}</p>
      )}
      <p className="small muted test-failure-note">{t("test.todo.note")}</p>
      <div className="test-failure-actions">
        <a className="btn primary" href={agentHref(requestFor(path, latest))}>
          <Icon name="agent" /> {t("test.todo.ask")}
        </a>
        {report !== undefined && (
          <a className="btn" href={report}>
            {t("test.todo.report")}
          </a>
        )}
      </div>
    </section>
  );
}
