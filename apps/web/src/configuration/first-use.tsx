import type { ReactNode } from "react";
import type { OqasConfig, RepositoryState } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { Page } from "../ui/page.tsx";
import { ApplicationCard } from "./application-card.tsx";
import { EditContext, NEW_ITEMS } from "./configuration-edit.ts";
import { AddButton, PlaceErrors } from "./configuration-fields.tsx";
import { ErrorSummary, type ConfigurationControls } from "./configuration-screen.tsx";
import { shownErrors, type ConfigurationState } from "./configuration-state.ts";
import { AddSourceButtons, FIRST_KINDS, KnowledgeCard } from "./knowledge-card.tsx";
import { ModelCard } from "./model-card.tsx";

/** The steps of the setting up, in their order. */
export const FIRST_USE_STEPS = ["welcome", "applications", "knowledge", "model", "summary"] as const;

/** A step of the setting up. */
export type FirstUseStep = (typeof FIRST_USE_STEPS)[number];

/** The first draft of a configuration: one application to describe, no knowledge yet, the GitHub account of the machine. */
export const FIRST_DRAFT: OqasConfig = {
  formatVersion: 1,
  applications: [NEW_ITEMS.application as unknown as OqasConfig["applications"][number]],
  knowledge: [],
  model: { mode: "github", model: "" },
};

/** What the setting up is given. */
export interface FirstUseProps {
  /** The name of the project: the folder of the test repository. */
  readonly project: string;
  readonly state: ConfigurationState;
  readonly controls: ConfigurationControls;
  /** The step the person is at. */
  readonly step: FirstUseStep;
  /** Goes back to the step before. */
  readonly onBack: () => void;
  /** Goes on to the step after. */
  readonly onNext: () => void;
}

/**
 * Sets up an instance that has no configuration yet, for a person who is not in IT: a welcome, the applications to
 * test, what the agents may read, the model, then a summary that writes the configuration and makes a Playwright
 * project of the test repository. Each step reuses the cards of the configuration, and the instance checks the draft
 * as it changes: nothing is written before the last step.
 *
 * @param props - The project, the state of the configuration, what the person does, and the step they are at.
 * @returns The step the person is at.
 */
export function FirstUse({ project, state, controls, step, onBack, onNext }: FirstUseProps): ReactNode {
  const draft = state.draft!;
  const title = t(`firstUse.${step}.title`);
  const actions =
    step === "welcome" ? (
      <button type="button" className="btn primary" onClick={onNext}>
        {t("firstUse.start")}
      </button>
    ) : (
      <div className="config-actions">
        <button type="button" className="btn" onClick={onBack}>
          {t("firstUse.back")}
        </button>
        {step === "summary" ? (
          <button type="button" className="btn primary" onClick={controls.setUp} disabled={state.saving}>
            {state.saving ? t("firstUse.creating") : t("firstUse.create")}
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={onNext}>
            {t("firstUse.next")}
          </button>
        )}
      </div>
    );
  return (
    <Page crumbs={[{ label: project }, { label: t("firstUse.crumb") }]} title={title}>
      {step !== "welcome" && (
        <ol className="first-use-steps" aria-label={t("firstUse.steps")}>
          {FIRST_USE_STEPS.slice(1).map((one) => (
            <li key={one} aria-current={one === step ? "step" : undefined}>
              {t(`firstUse.${one}.short`)}
            </li>
          ))}
        </ol>
      )}
      <p className="first-use-lead">{t(`firstUse.${step}.lead`)}</p>
      {step === "welcome" && state.repository !== undefined && (
        <p className="small muted">
          {t("firstUse.welcome.folder")} <code className="mono">{state.repository.folder}</code> {t("firstUse.welcome.otherFolder")}
        </p>
      )}
      {state.refusal !== undefined && (
        <p className="config-note ko" role="alert">
          {state.refusal.text}
        </p>
      )}
      {/* What is left to correct is told before anything is written; each field says it beside itself before. */}
      {step === "summary" && <ErrorSummary errors={state.errors} draft={draft} />}
      <EditContext.Provider
        value={{
          change: controls.change,
          click: controls.click,
          errors: shownErrors(state),
          draft,
          values: state.values,
          checkAddress: controls.checkAddress,
          ...(state.addressChecks === undefined ? {} : { addressChecks: state.addressChecks }),
        }}
      >
        {step === "applications" && (
          <section className="config-section" aria-label={title}>
            <PlaceErrors pointer="/applications" />
            {draft.applications.map((application, rank) => (
              <ApplicationCard key={rank} application={application} rank={rank} />
            ))}
            <div className="config-actions">
              <AddButton pointer="/applications" item="application">
                {t("configuration.screen.addApplication")}
              </AddButton>
            </div>
          </section>
        )}
        {step === "knowledge" && (
          <section className="config-section" aria-label={title}>
            {draft.knowledge.map((source, rank) => (
              <KnowledgeCard
                key={rank}
                source={source}
                rank={rank}
                applications={draft.applications}
                onCheck={controls.checkSource}
                {...(state.sourceChecks?.[rank] === undefined ? {} : { test: state.sourceChecks[rank] })}
              />
            ))}
            <AddSourceButtons kinds={FIRST_KINDS} />
          </section>
        )}
        {step === "model" && (
          <section className="config-section" aria-label={title}>
            <ModelCard model={draft.model} onTest={controls.testModel} {...(state.connection === undefined ? {} : { connection: state.connection })} />
          </section>
        )}
      </EditContext.Provider>
      {step === "summary" && <Summary draft={draft} repository={state.repository} />}
      {actions}
    </Page>
  );
}

/** What the setting up will write and do, said before it does. */
function Summary({ draft, repository }: { readonly draft: OqasConfig; readonly repository: RepositoryState | undefined }): ReactNode {
  const named = draft.applications.map(({ name, id }) => name || id || t("firstUse.summary.unnamed"));
  return (
    <ul className="first-use-summary">
      <li>{t("firstUse.summary.applications", { count: named.length, names: named.join(", ") })}</li>
      <li>
        {t("firstUse.summary.knowledge", { count: draft.knowledge.length })}
        {draft.knowledge.length > 0 && ` ${t("firstUse.summary.mapping")}`}
      </li>
      <li>
        {draft.model.mode === "github"
          ? t("firstUse.summary.github", { model: draft.model.model })
          : t("firstUse.summary.provider", { model: draft.model.model })}
      </li>
      <li>{repository?.git === "none" ? t("firstUse.summary.newRepository") : t("firstUse.summary.existingRepository")}</li>
    </ul>
  );
}
