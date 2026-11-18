import type { ReactNode } from "react";
import type { ScopeStep } from "@open-qa-stack/domain/sessions";
import { Trans } from "react-i18next/TransWithoutContext";
import { i18n, t } from "../i18n/i18n.ts";
import { Badge } from "../ui/badge.tsx";

/**
 * What the session works on, at the head of its thread: the levels of the pyramid of tests asked, which alone are
 * designed, the applications and the environment, with where the levels are asked.
 *
 * @param props - The step of the scope.
 * @returns The card.
 */
export function ScopeCard({ step }: { readonly step: ScopeStep }): ReactNode {
  return (
    <section className="result-card scope" aria-label={step.title}>
      <header>
        <div className="lead">
          <b>{step.title}</b>
        </div>
        <span className="turn-at">{step.at}</span>
      </header>
      <dl className="facts scope-facts">
        <div className="fact">
          <dt>{t("scope.levels")}</dt>
          <dd className="badges">
            {step.levels.map((level) => (
              <Badge key={level} tone="info">
                {level}
              </Badge>
            ))}
          </dd>
        </div>
        <div className="fact">
          <dt>{t("scope.applications")}</dt>
          <dd>{step.applications.join(", ")}</dd>
        </div>
        <div className="fact">
          <dt>{t("scope.environment")}</dt>
          <dd>{step.environment}</dd>
        </div>
      </dl>
      <p className="scope-note">
        <Trans i18n={i18n} i18nKey="scope.note" components={{ code: <span className="mono" /> }} />
      </p>
    </section>
  );
}
