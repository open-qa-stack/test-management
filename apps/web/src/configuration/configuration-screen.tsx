import type { FormEventHandler, MouseEventHandler, ReactNode } from "react";
import type { ConfigError } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { ApplicationCard } from "./application-card.tsx";
import { EditContext, type ConfigurationEdit } from "./configuration-edit.ts";
import { AddButton, PlaceErrors } from "./configuration-fields.tsx";
import { isChanged, type ConfigurationState } from "./configuration-state.ts";
import { errorText } from "./configuration-words.ts";
import { HistoryCard, JsonCard, KnowledgeCard } from "./record-cards.tsx";
import { AutonomyCard, DesignCard, LanguageCard, ModelCard, RepositoryCard } from "./settings-cards.tsx";

/** The form of the configuration, which the buttons of the head of the page submit. */
export const FORM_ID = "configuration-form";

/** What the person does on the screen besides changing a field. */
export interface ConfigurationControls extends Omit<ConfigurationEdit, "errors"> {
  /** Saves the draft. */
  readonly save: FormEventHandler<HTMLFormElement>;
  /** Drops the draft for the revision in force. */
  readonly discard: MouseEventHandler<HTMLButtonElement>;
  /** Takes the configuration file as the revision in force. */
  readonly keepFile: MouseEventHandler<HTMLButtonElement>;
  /** Saves the draft over a configuration file that changed too. */
  readonly keepChange: MouseEventHandler<HTMLButtonElement>;
}

/** What the screen of the configuration is drawn from. */
export interface ConfigurationScreenProps {
  /** The name of the project. */
  readonly project: string;
  readonly state: ConfigurationState;
  readonly controls: ConfigurationControls;
}

/** The errors of the draft, counted, each with where it is, at the head of the form. */
function ErrorSummary({ errors }: { readonly errors: readonly ConfigError[] }): ReactNode {
  if (errors.length === 0) return null;
  return (
    <section className="config-note ko" aria-labelledby="config-errors-title">
      <b id="config-errors-title">{t("configuration.screen.errors", { count: errors.length })}</b>
      <ul>
        {errors.map((error, index) => (
          <li key={index}>
            <code className="mono">{error.path || "/"}</code> {errorText(error)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What the screen says of the file and of what the instance answered, with the ways out it leaves. */
function Notes({ state, controls }: { readonly state: ConfigurationState; readonly controls: ConfigurationControls }): ReactNode {
  const { view, refusal, saved, saving } = state;
  if (refusal?.code === "configuration_conflict")
    return (
      <section className="config-note warn" role="alert">
        <b>{t("configuration.screen.conflict")}</b>
        <span>{t("configuration.screen.conflictNote")}</span>
        <div className="config-actions">
          <button type="button" className="btn" onClick={controls.keepFile} disabled={saving}>
            {t("configuration.screen.keepFile")}
          </button>
          <button type="button" className="btn primary" onClick={controls.keepChange} disabled={saving}>
            {t("configuration.screen.keepChange")}
          </button>
        </div>
      </section>
    );
  if (refusal !== undefined)
    return (
      <p className="config-note ko" role="alert">
        {refusal.text}
      </p>
    );
  if (view?.file === "changed")
    return (
      <section className="config-note warn">
        <b>{t("configuration.screen.fileChanged")}</b>
        <span>{t("configuration.screen.fileChangedNote")}</span>
        <div className="config-actions">
          <button type="button" className="btn" onClick={controls.keepFile} disabled={saving}>
            {t("configuration.screen.takeFile")}
          </button>
        </div>
      </section>
    );
  if (view?.file === "missing") return <p className="config-note info">{t("configuration.screen.fileMissing")}</p>;
  return saved === undefined ? null : (
    <p className="config-note ok" role="status">
      {t("configuration.screen.saved", { number: saved })}
    </p>
  );
}

/**
 * The configuration of the instance: what the person changes — the applications and their environments, the
 * model, the autonomy, the levels of design, the layout of the repository — then saves; what is read only — the
 * knowledge sources, the JSON — and the history of the revisions.
 *
 * @param props - The project, the state of the screen and what the person does on it.
 * @returns The screen.
 */
export function ConfigurationScreen({ project, state, controls }: ConfigurationScreenProps): ReactNode {
  const { draft, view, errors, saving, unread, revisions } = state;
  const changed = isChanged(state);
  const title = t("configuration.screen.title");
  const crumbs = [{ label: project }, { label: title }];
  if (draft === undefined)
    return (
      <Page crumbs={crumbs} title={title}>
        {view === undefined ? (
          <EmptyState title={t("configuration.screen.reading")}>
            <span role="status">{unread ?? t("configuration.screen.readingNote")}</span>
          </EmptyState>
        ) : (
          <>
            <Notes state={state} controls={controls} />
            <EmptyState title={t("configuration.screen.none")}>{t("configuration.screen.noneNote")}</EmptyState>
          </>
        )}
      </Page>
    );
  const actions = (
    <div className="config-head">
      <span className="small muted config-state" role="status">
        {saving
          ? t("configuration.screen.saving")
          : changed
            ? t("configuration.screen.unsaved")
            : t("configuration.screen.inForce", { number: view!.revision!.number })}
      </span>
      <button type="button" className="btn" onClick={controls.discard} disabled={!changed || saving}>
        {t("configuration.screen.discard")}
      </button>
      <button type="submit" form={FORM_ID} className="btn primary" disabled={!changed || saving}>
        {t("configuration.screen.save")}
      </button>
    </div>
  );
  return (
    <Page crumbs={crumbs} title={title} actions={actions}>
      <Notes state={state} controls={controls} />
      <ErrorSummary errors={errors} />
      <EditContext.Provider value={{ change: controls.change, click: controls.click, errors }}>
        <form id={FORM_ID} className="config-form" onSubmit={controls.save} noValidate>
          <section className="config-section" aria-labelledby="config-applications">
            <h2 id="config-applications">{t("configuration.screen.applications")}</h2>
            <PlaceErrors pointer="/applications" />
            {draft.applications.map((application, index) => (
              <ApplicationCard key={index} application={application} rank={index} />
            ))}
            <div className="config-actions">
              <AddButton pointer="/applications" item="application">
                {t("configuration.screen.addApplication")}
              </AddButton>
            </div>
          </section>
          <section className="config-section" aria-labelledby="config-agents">
            <h2 id="config-agents">{t("configuration.screen.agents")}</h2>
            <ModelCard model={draft.model} />
            <AutonomyCard {...(draft.autonomy === undefined ? {} : { autonomy: draft.autonomy })} />
            <DesignCard design={draft.design} />
            <LanguageCard config={draft} />
          </section>
          <section className="config-section" aria-labelledby="config-repository">
            <h2 id="config-repository">{t("configuration.screen.repository")}</h2>
            <RepositoryCard {...(draft.repository === undefined ? {} : { repository: draft.repository })} />
            <KnowledgeCard knowledge={draft.knowledge} />
          </section>
        </form>
      </EditContext.Provider>
      <section className="config-section" aria-labelledby="config-history">
        <h2 id="config-history">{t("configuration.screen.history")}</h2>
        {/* The instance tells the revisions with the configuration: there is a draft once it told them. */}
        <HistoryCard revisions={revisions!} />
        <JsonCard draft={draft} />
      </section>
      <Card className="config-secrets">
        <p className="row small muted">{t("configuration.screen.secrets")}</p>
      </Card>
    </Page>
  );
}
