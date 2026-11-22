import type { ReactNode } from "react";
import type { PlannedExpect, PlannedScenario, PlanScenario, PlanStep } from "@open-qa-stack/domain/sessions";
import { Badge } from "../ui/badge.tsx";
import { t, type Words } from "../i18n/i18n.ts";
import { levelName } from "../i18n/vocabulary.ts";
import { applicationName } from "../applications/application-names.ts";

/** A value of a plan, in the words of the console; one it does not know reads as it is. */
function worded(value: string): string {
  return t(`plan.words.${value as keyof Words["plan"]["words"]}`, { defaultValue: value });
}

/** What a scenario is said to be beside its title: its case and the application it tests. */
function placeOf(scenario: PlannedScenario): string {
  return [
    scenario.case === undefined ? undefined : worded(scenario.case),
    scenario.application === undefined ? undefined : applicationName(scenario.application),
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}

/** The facts of a scenario, each with its label, those the plan does not say left out. */
function factsOf(scenario: PlannedScenario): (readonly [string, ReactNode])[] {
  const facts: (readonly [string, ReactNode | undefined])[] = [
    [t("plan.facts.id"), <span className="mono">{scenario.id}</span>],
    [t("plan.facts.level"), levelName(scenario.level)],
    [t("plan.facts.case"), scenario.case === undefined ? undefined : worded(scenario.case)],
    [t("plan.facts.effect"), scenario.effect === undefined ? undefined : worded(scenario.effect)],
    [t("plan.facts.kind"), scenario.kind === undefined ? undefined : worded(scenario.kind)],
    [t("plan.facts.application"), scenario.application === undefined ? undefined : applicationName(scenario.application)],
    [t("plan.facts.domain"), [scenario.domain, scenario.feature].filter((part) => part !== undefined).join(" · ") || undefined],
    [
      t("plan.facts.sources"),
      scenario.sources === undefined || scenario.sources.length === 0 ? undefined : (
        <ul className="plain-list">
          {scenario.sources.map((source, index) => (
            <li key={index}>
              {source.source}
              {source.item !== undefined && <span className="mono"> {source.item}</span>}
            </li>
          ))}
        </ul>
      ),
    ],
    [
      t("plan.facts.data"),
      scenario.data === undefined ? undefined : scenario.data.length === 0 ? (
        t("plan.noInput")
      ) : (
        <ul className="plain-list">
          {scenario.data.map((value, index) => (
            <li key={index}>
              <code className="shown-text">{value.value}</code> {worded(value.from)}
            </li>
          ))}
        </ul>
      ),
    ],
  ];
  return facts.filter((fact): fact is readonly [string, ReactNode] => fact[1] !== undefined);
}

/** The texts an expect names, under their label: what the screen shows, or no longer shows. */
function Texts({ label, texts }: { readonly label: string; readonly texts: readonly string[] }): ReactNode {
  if (texts.length === 0) return undefined;
  return (
    <div className="expect-texts">
      <span className="expect-label">{label}</span>
      {texts.map((text, index) => (
        <code key={index} className="shown-text">
          {text}
        </code>
      ))}
    </div>
  );
}

/** What a step expects after its action: the result, then the texts that prove it. */
function Expect({ expect }: { readonly expect: PlannedExpect }): ReactNode {
  return (
    <li>
      <p className="expect-result">{expect.result}</p>
      <Texts label={t("plan.shows")} texts={expect.shows} />
      <Texts label={t("plan.absent")} texts={expect.absent} />
    </li>
  );
}

/**
 * A scenario of a plan, as a cell that unfolds: its level, its title and where it applies on its line; unfolded,
 * what it verifies, every fact the plan gives, each step with what it expects, then the scenario as the event
 * told it, folded under “Details”. The refusals of the harness about it before the plan was accepted are counted on
 * its line and told in full under its steps. A scenario of a thread written before the plan told more shows what it has.
 */
function ScenarioCell({ scenario }: { readonly scenario: PlanScenario }): ReactNode {
  const { refusals, ...planned } = scenario;
  const place = placeOf(planned);
  return (
    <details className="scenario">
      <summary className="scenario-head">
        <Badge tone="neutral">{levelName(planned.level)}</Badge>
        <span className="result-title">{planned.title}</span>
        {place !== "" && <span className="turn-role">{place}</span>}
        {refusals.length > 0 && <Badge tone="warn">{t("count.refusals", { count: refusals.length })}</Badge>}
      </summary>
      <div className="scenario-body">
        {planned.intent !== undefined && <p className="scenario-intent">{planned.intent}</p>}
        <dl className="facts">
          {factsOf(planned).map(([label, value]) => (
            <div key={label} className="fact">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {planned.steps !== undefined && planned.steps.length > 0 && (
          <ol className="scenario-steps" aria-label={t("plan.steps")}>
            {planned.steps.map((step, index) => (
              <li key={index}>
                <p className="scenario-action">
                  {step.action}
                  {step.restores === true && (
                    <>
                      {" "}
                      <Badge tone="outline">{t("plan.restores")}</Badge>
                    </>
                  )}
                </p>
                {step.expects.length > 0 && (
                  <ul className="expects">
                    {step.expects.map((expect, rank) => (
                      <Expect key={rank} expect={expect} />
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
        {refusals.length > 0 && (
          <section className="scenario-refusals" aria-label={t("plan.refusalsLabel")}>
            <p className="expect-label">{t("plan.refusalsTitle")}</p>
            <ol className="plain-list">
              {refusals.map((refusal, index) => (
                <li key={index} className="scenario-refusal">
                  <span className="turn-at">{refusal.at}</span>
                  {refusal.code !== undefined && <span className="verdict-code">{refusal.code}</span>}
                  <span className="scenario-refusal-text">{refusal.reason}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        <details className="raw">
          <summary>{t("plan.details")}</summary>
          <pre>{JSON.stringify(planned, null, 2)}</pre>
        </details>
      </div>
    </details>
  );
}

/**
 * The plan of a pass, once accepted: a cell for each of its scenarios, folded to its line, which unfolds on all
 * the plan says of it.
 *
 * @param props - The step of the plan.
 * @returns The card.
 */
export function PlanCard({ step }: { readonly step: PlanStep }): ReactNode {
  return (
    <section className="result-card plan">
      <header>
        <div className="lead">
          <span className="act-state ok" aria-hidden="true" />
          <b>{step.title}</b>
          <span className="turn-role">{t("count.scenarios", { count: step.scenarios.length })}</span>
        </div>
        <span className="turn-at">{step.at}</span>
      </header>
      {step.scenarios.map((scenario, index) => (
        <ScenarioCell key={index} scenario={scenario} />
      ))}
    </section>
  );
}
