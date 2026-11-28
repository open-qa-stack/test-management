import type { ReactNode } from "react";
import { stepWording, type ExecutionFailure, type RepositoryTest } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { Card } from "../ui/card.tsx";
import { Icon } from "../ui/icon.tsx";

/** What the steps of a test need. */
export interface TestStepsProps {
  readonly test: RepositoryTest;
  /** The link to the panel that changes a step, by its number. */
  readonly editHref: (number: number) => string;
  /** Where its last run failed, when it did. */
  readonly failure?: ExecutionFailure;
}

/** Where the last run failed, under the step it failed at: there, and what the assertion expected and received when its message says both. */
function failureText({ expected, received }: ExecutionFailure): string {
  return [t("test.failedHere"), ...(expected === undefined || received === undefined ? [] : [t("test.compared", { expected, received })])].join(" · ");
}

/**
 * The steps of a test as its file writes them, a numbered list: the number the harness writes before a step is the
 * one the list gives it. The step the last run failed at is marked, in the tone of the failure, with what was
 * expected and received. A pencil leads each step to the panel that changes its text.
 *
 * @param props - The test, the link to the panel of a step by its number, and where its last run failed.
 * @returns The card.
 */
export function TestSteps({ test, editHref, failure }: TestStepsProps): ReactNode {
  return (
    <Card title={t("test.steps")} hint={t("test.written", { count: test.steps.length })}>
      {test.steps.length === 0 ? (
        <p className="test-compare small muted">{t("test.noWrittenStep")}</p>
      ) : (
        <ol className="test-written">
          {test.steps.map((step, rank) => {
            const failed = failure?.step?.number === rank + 1;
            return (
              <li key={rank} className={failed ? "row test-written-step failed" : "row test-written-step"}>
                <span className={failed ? "test-step-number failed" : "test-step-number muted"}>{rank + 1}.</span>
                <span className="grow">
                  {stepWording(step).text}
                  {failed && <span className="test-step-facts ko">{failureText(failure!)}</span>}
                </span>
                <a className="btn ghost sm test-step-edit" href={editHref(rank + 1)} aria-label={t("test.editStepNamed", { number: rank + 1 })}>
                  <Icon name="pen" />
                </a>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
