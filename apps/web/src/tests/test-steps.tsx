import type { ReactNode } from "react";
import { stepWording, type RepositoryTest } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { Card } from "../ui/card.tsx";

/**
 * The steps of a test as its file writes them, a numbered list without what came of them: the number the harness
 * writes before a step is the one the list gives it. Each step leads to the panel that changes its text.
 *
 * @param props - The test, and the link to the panel of a step by its number.
 * @returns The card.
 */
export function TestSteps({ test, editHref }: { readonly test: RepositoryTest; readonly editHref: (number: number) => string }): ReactNode {
  return (
    <Card title={t("test.steps")} hint={t("test.written", { count: test.steps.length })}>
      {test.steps.length === 0 ? (
        <p className="test-compare small muted">{t("test.noWrittenStep")}</p>
      ) : (
        <ol className="test-written">
          {test.steps.map((step, rank) => (
            <li key={rank} className="row test-written-step">
              <span className="test-step-number muted">{rank + 1}.</span>
              <span className="grow">{stepWording(step).text}</span>
              <a className="btn sm" href={editHref(rank + 1)} aria-label={t("test.editStepNamed", { number: rank + 1 })}>
                {t("test.editStep")}
              </a>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
