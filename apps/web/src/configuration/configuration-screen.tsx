import type { FormEventHandler, MouseEventHandler, ReactNode } from "react";
import type { ConfigError, OqasConfig } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import type { Route } from "../routing/route.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { EditContext, type ConfigurationEdit } from "./configuration-edit.ts";
import { isPending, shownErrors, type ConfigurationState } from "./configuration-state.ts";
import { placeText } from "./config-place.ts";
import { errorText } from "./configuration-words.ts";
import { FileCard, HistoryCard, JsonCard } from "./record-cards.tsx";
import { AgentsCard } from "./agents-card.tsx";
import { ModelCard } from "./model-card.tsx";
import { AutonomyCard, DesignCard, LanguageCard, RepositoryCard } from "./settings-cards.tsx";
import { SaveBar } from "./save-bar.tsx";

/** The form of the configuration, which the bar at its foot submits. */
export const FORM_ID = "configuration-form";

/** What the person does on the screen besides changing a field. */
export interface ConfigurationControls extends Omit<ConfigurationEdit, "errors" | "secrets" | "values" | "addressChecks" | "checkAddress"> {
  /** Saves the draft. */
  readonly save: FormEventHandler<HTMLFormElement>;
  /** Drops the draft for the revision in force. */
  readonly discard: MouseEventHandler<HTMLButtonElement>;
  /** Takes the configuration file as the revision in force. */
  readonly takeFile: MouseEventHandler<HTMLButtonElement>;
  /** Writes the revision in force to the configuration file. */
  readonly writeFile: MouseEventHandler<HTMLButtonElement>;
  readonly testModel: MouseEventHandler<HTMLButtonElement>;
  /** Tests the knowledge source of the draft its button names by its rank. */
  readonly checkSource: MouseEventHandler<HTMLButtonElement>;
  /** Tests the address of an environment the button names by the pointer of its field. */
  readonly checkAddress: MouseEventHandler<HTMLButtonElement>;
  /** Writes the first configuration of an instance that has none, then sets its test repository up. */
  readonly setUp: MouseEventHandler<HTMLButtonElement>;
}

/** What the screen of the configuration is drawn from. */
export interface ConfigurationScreenProps {
  /** Where the console is, which tells the panel open. */
  readonly route: Route;
  /** The name of the project. */
  readonly project: string;
  readonly state: ConfigurationState;
  readonly controls: ConfigurationControls;
}

/** The errors of the draft, counted, each with where it is in words, at the head of the form. */
export function ErrorSummary({ errors, draft }: { readonly errors: readonly ConfigError[]; readonly draft: OqasConfig | undefined }): ReactNode {
  if (errors.length === 0) return null;
  return (
    <section className="config-note ko" aria-labelledby="config-errors-title">
      <b id="config-errors-title">{t("configuration.screen.errors", { count: errors.length })}</b>
      <ul>
        {errors.map((error, index) => (
          <li key={index}>
            <b>{placeText(error.path, draft)}</b> {errorText(error, draft)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What the screen says of what the instance answered, with the ways out it leaves. */
export function Notes({ state }: { readonly state: ConfigurationState }): ReactNode {
  const { refusal, saved } = state;
  if (refusal !== undefined)
    return (
      <p className="config-note ko" role="alert">
        {refusal.text}
      </p>
    );
  if (state.preparation !== undefined)
    return (
      <section className="config-note ok" role="status">
        <b>{t("firstUse.ready.title")}</b>
        <span>{t(state.preparation.committed ? "firstUse.ready.committed" : "firstUse.ready.toCommit")}</span>
        <div className="config-actions">
          <a className="btn primary" href="#/agent">
            {t("firstUse.ready.agent")}
          </a>
        </div>
      </section>
    );
  const told = [
    ...(saved === undefined ? [] : [t("configuration.screen.saved", { number: saved })]),
    ...(state.valued ? [t("configuration.screen.valued")] : []),
  ];
  return told.length === 0 ? null : (
    <p className="config-note ok" role="status">
      {told.join(" ")}
    </p>
  );
}

/**
 * The settings of Open QA Stack: what the person changes — the model, the autonomy, the levels of design, the layout of the
 * repository — then saves; what is read only — the JSON — and the history of the revisions.
 *
 * @param props - The project, the state of the screen and what the person does on it.
 * @returns The screen.
 */
export function ConfigurationScreen({ project, state, controls, route }: ConfigurationScreenProps): ReactNode {
  const { draft, view, saving, unread, revisions } = state;
  const errors = shownErrors(state);
  const pending = isPending(state);
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
            <Notes state={state} />
            <EmptyState title={t("configuration.screen.none")}>
              {t("configuration.screen.noneNote")}
              {view.file === "changed" && (
                <div className="config-actions">
                  <button type="button" className="btn primary" onClick={controls.takeFile} disabled={saving}>
                    {t("configuration.records.takeFile")}
                  </button>
                </div>
              )}
            </EmptyState>
          </>
        )}
      </Page>
    );
  return (
    <Page crumbs={crumbs} title={title} hint={t("configuration.screen.lead")}>
      <Notes state={state} />
      <ErrorSummary errors={errors} draft={draft} />
      <EditContext.Provider
        value={{
          change: controls.change,
          click: controls.click,
          errors,
          draft,
          values: state.values,
          ...(state.secrets === undefined ? {} : { secrets: state.secrets }),
        }}
      >
        <form id={FORM_ID} className="config-form" onSubmit={controls.save} noValidate>
          <section className="config-section" aria-labelledby="config-agents">
            <h2 id="config-agents">{t("configuration.screen.agents")}</h2>
            <ModelCard model={draft.model} onTest={controls.testModel} {...(state.connection === undefined ? {} : { connection: state.connection })} />
            <AutonomyCard {...(draft.autonomy === undefined ? {} : { autonomy: draft.autonomy })} />
            <DesignCard design={draft.design} />
            <LanguageCard config={draft} />
            <AgentsCard
              agents={draft.agents}
              route={route}
              wrong={(pointer) => errors.some(({ path }) => path === pointer || path.startsWith(`${pointer}/`))}
              footer={<SaveBar saving={saving} pending={pending} saved={t("configuration.item.saved")} discard={controls.discard} />}
            />
          </section>
          <section className="config-section" aria-labelledby="config-repository">
            <h2 id="config-repository">{t("configuration.screen.repository")}</h2>
            <RepositoryCard {...(draft.repository === undefined ? {} : { repository: draft.repository })} />
          </section>
          <p className="small muted config-secrets">{t("configuration.screen.secrets")}</p>
          <SaveBar saving={saving} pending={pending} saved={t("configuration.screen.inForce", { number: view!.revision!.number })} discard={controls.discard} />
        </form>
      </EditContext.Provider>
      {/* The history, the file and the JSON are an expert's: they are folded. */}
      <details className="config-section config-advanced">
        <summary>
          <h2 id="config-history">{t("configuration.screen.history")}</h2>
        </summary>
        {/* The instance tells the revisions with the configuration: there is a draft once it told them. */}
        <HistoryCard revisions={revisions!} />
        <FileCard file={view!.file} saving={saving} controls={controls} />
        <JsonCard draft={draft} />
      </details>
    </Page>
  );
}
