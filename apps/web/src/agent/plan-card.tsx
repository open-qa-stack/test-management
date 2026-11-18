import type { ReactNode } from "react";
import type { PlannedExpect, PlannedScenario, PlanStep } from "@open-qa-stack/domain/sessions";
import { Badge } from "../ui/badge.tsx";
import { counted } from "../ui/counted.ts";

/** How the values a plan gives a scenario read; one this console does not know reads as it is. */
const WORDS: Readonly<Record<string, string>> = {
  nominal: "nominal",
  negative: "négatif",
  read: "lecture seule",
  write: "écrit des données",
  functional: "fonctionnel",
  visual: "visuel",
  accessibility: "accessibilité",
  other: "autre",
  "made-up": "inventée",
};

/** A value of a plan, in the words of the console. */
function worded(value: string): string {
  return WORDS[value] ?? value;
}

/** What a scenario is said to be beside its title: its case and the application it tests. */
function placeOf(scenario: PlannedScenario): string {
  return [scenario.case === undefined ? undefined : worded(scenario.case), scenario.application].filter((part) => part !== undefined).join(" · ");
}

/** The facts of a scenario, each with its label, those the plan does not say left out. */
function factsOf(scenario: PlannedScenario): (readonly [string, ReactNode])[] {
  const facts: (readonly [string, ReactNode | undefined])[] = [
    ["Identifiant", <span className="mono">{scenario.id}</span>],
    ["Niveau", scenario.level],
    ["Cas", scenario.case === undefined ? undefined : worded(scenario.case)],
    ["Effet", scenario.effect === undefined ? undefined : worded(scenario.effect)],
    ["Nature", scenario.kind === undefined ? undefined : worded(scenario.kind)],
    ["Application", scenario.application],
    ["Domaine", [scenario.domain, scenario.feature].filter((part) => part !== undefined).join(" · ") || undefined],
    [
      "Sources",
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
      "Données",
      scenario.data === undefined ? undefined : scenario.data.length === 0 ? (
        "aucune saisie"
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
      <Texts label="Affiche" texts={expect.shows} />
      <Texts label="N’affiche plus" texts={expect.absent} />
    </li>
  );
}

/**
 * A scenario of a plan, as a cell that unfolds: its level, its title and where it applies on its line; unfolded,
 * what it verifies, every fact the plan gives, each step with what it expects, then the scenario as the event
 * told it, folded under « Détails ». A scenario of a thread written before the plan told more shows what it has.
 */
function ScenarioCell({ scenario }: { readonly scenario: PlannedScenario }): ReactNode {
  const place = placeOf(scenario);
  return (
    <details className="scenario">
      <summary className="scenario-head">
        <Badge tone="neutral">{scenario.level}</Badge>
        <span className="result-title">{scenario.title}</span>
        {place !== "" && <span className="turn-role">{place}</span>}
      </summary>
      <div className="scenario-body">
        {scenario.intent !== undefined && <p className="scenario-intent">{scenario.intent}</p>}
        <dl className="facts">
          {factsOf(scenario).map(([label, value]) => (
            <div key={label} className="fact">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {scenario.steps !== undefined && scenario.steps.length > 0 && (
          <ol className="scenario-steps" aria-label="Étapes">
            {scenario.steps.map((step, index) => (
              <li key={index}>
                <p className="scenario-action">
                  {step.action}
                  {step.restores === true && (
                    <>
                      {" "}
                      <Badge tone="outline">remet en état</Badge>
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
        <details className="raw">
          <summary>Détails</summary>
          <pre>{JSON.stringify(scenario, null, 2)}</pre>
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
          <span className="turn-role">{counted(step.scenarios.length, "scénario", "scénarios")}</span>
        </div>
        <span className="turn-at">{step.at}</span>
      </header>
      {step.scenarios.map((scenario, index) => (
        <ScenarioCell key={index} scenario={scenario} />
      ))}
    </section>
  );
}
