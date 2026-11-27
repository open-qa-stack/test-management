import type { ReactNode } from "react";
import type { TestExecution } from "@open-qa-stack/domain/sessions";
import { agentHref } from "../agent/agent-paths.ts";
import { FailureNote } from "../executions/failure-note.tsx";
import { t } from "../i18n/i18n.ts";
import { Card } from "../ui/card.tsx";

/** What is asked of the agent for a test that failed: to find why and to repair it, with its path and where it failed. */
function requestFor(path: string, { result: { title, failure } }: TestExecution): string {
  const step = failure?.step === undefined ? "" : t("test.todo.atStep", failure.step);
  return t("test.todo.request", { title, path, step });
}

/**
 * What to do with a test whose last run failed: where it failed, the agent to ask, whose request is written for the
 * person to send, and the defect to report.
 *
 * @param props - The path of the test, its latest execution, and the link to the panel that reports a defect of it.
 * @returns The card; nothing for a test that did not fail.
 */
export function WhatToDo({ path, latest, report }: { readonly path: string; readonly latest: TestExecution | undefined; readonly report?: string }): ReactNode {
  if (latest?.result.verdict !== "failed") return null;
  return (
    <Card title={t("test.todo.title")}>
      <div className="row test-summary">
        <div className="grow">
          <FailureNote failure={latest.result.failure} />
          <div className="small muted">{t("test.todo.note")}</div>
        </div>
        <a className="btn" href={agentHref(requestFor(path, latest))}>
          {t("test.todo.ask")}
        </a>
        {report !== undefined && (
          <a className="btn ghost" href={report}>
            {t("test.todo.report")}
          </a>
        )}
      </div>
    </Card>
  );
}
