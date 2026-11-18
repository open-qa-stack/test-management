import type { FormEventHandler, MouseEventHandler, ReactNode } from "react";
import type { ConfigError } from "@open-qa-stack/domain/sessions";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { ApplicationCard } from "./application-card.tsx";
import { EditContext, type ConfigurationEdit } from "./configuration-edit.ts";
import { AddButton, PlaceErrors } from "./configuration-fields.tsx";
import { isChanged, type ConfigurationState } from "./configuration-state.ts";
import { errorText } from "./configuration-words.ts";
import { HistoryCard, JsonCard, KnowledgeCard } from "./record-cards.tsx";
import { AutonomyCard, DesignCard, ModelCard, RepositoryCard } from "./settings-cards.tsx";

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
      <b id="config-errors-title">
        {errors.length === 1 ? "1 erreur à corriger avant d’enregistrer" : `${errors.length} erreurs à corriger avant d’enregistrer`}
      </b>
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
        <b>oqas.json a changé depuis la dernière synchronisation</b>
        <span>Vos modifications le réécriraient. Rien n’est fusionné : choisissez ce qui est gardé.</span>
        <div className="config-actions">
          <button type="button" className="btn" onClick={controls.keepFile} disabled={saving}>
            Garder le fichier
          </button>
          <button type="button" className="btn primary" onClick={controls.keepChange} disabled={saving}>
            Garder mes modifications
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
        <b>oqas.json a changé depuis la révision en vigueur</b>
        <span>Il sera pris au démarrage de la prochaine session, ou maintenant.</span>
        <div className="config-actions">
          <button type="button" className="btn" onClick={controls.keepFile} disabled={saving}>
            Prendre oqas.json
          </button>
        </div>
      </section>
    );
  if (view?.file === "missing")
    return <p className="config-note info">oqas.json est introuvable dans le dépôt de tests : le prochain enregistrement l’écrira.</p>;
  return saved === undefined ? null : (
    <p className="config-note ok" role="status">
      Révision {saved} enregistrée : oqas.json est réécrit, et la prochaine session la lit.
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
  const crumbs = [{ label: project }, { label: "Configuration" }];
  if (draft === undefined)
    return (
      <Page crumbs={crumbs} title="Configuration">
        {view === undefined ? (
          <EmptyState title="Lecture de la configuration">
            <span role="status">{unread ?? "Elle apparaît dès que l’instance a répondu."}</span>
          </EmptyState>
        ) : (
          <>
            <Notes state={state} controls={controls} />
            <EmptyState title="L’instance n’a pas encore de configuration">Écrivez oqas.json à la racine du dépôt de tests : la console le reprend.</EmptyState>
          </>
        )}
      </Page>
    );
  const actions = (
    <div className="config-head">
      <span className="small muted config-state" role="status">
        {saving ? "Enregistrement…" : changed ? "Modifications non enregistrées" : `Révision ${view!.revision!.number} en vigueur`}
      </span>
      <button type="button" className="btn" onClick={controls.discard} disabled={!changed || saving}>
        Annuler les modifications
      </button>
      <button type="submit" form={FORM_ID} className="btn primary" disabled={!changed || saving}>
        Enregistrer
      </button>
    </div>
  );
  return (
    <Page crumbs={crumbs} title="Configuration" actions={actions}>
      <Notes state={state} controls={controls} />
      <ErrorSummary errors={errors} />
      <EditContext.Provider value={{ change: controls.change, click: controls.click, errors }}>
        <form id={FORM_ID} className="config-form" onSubmit={controls.save} noValidate>
          <section className="config-section" aria-labelledby="config-applications">
            <h2 id="config-applications">Applications et environnements</h2>
            <PlaceErrors pointer="/applications" />
            {draft.applications.map((application, index) => (
              <ApplicationCard key={index} application={application} rank={index} />
            ))}
            <div className="config-actions">
              <AddButton pointer="/applications" item="application">
                Ajouter une application
              </AddButton>
            </div>
          </section>
          <section className="config-section" aria-labelledby="config-agents">
            <h2 id="config-agents">Agents</h2>
            <ModelCard model={draft.model} />
            <AutonomyCard {...(draft.autonomy === undefined ? {} : { autonomy: draft.autonomy })} />
            <DesignCard design={draft.design} />
          </section>
          <section className="config-section" aria-labelledby="config-repository">
            <h2 id="config-repository">Dépôt de tests</h2>
            <RepositoryCard {...(draft.repository === undefined ? {} : { repository: draft.repository })} />
            <KnowledgeCard knowledge={draft.knowledge} />
          </section>
        </form>
      </EditContext.Provider>
      <section className="config-section" aria-labelledby="config-history">
        <h2 id="config-history">Historique</h2>
        {/* The instance tells the revisions with the configuration: there is a draft once it told them. */}
        <HistoryCard revisions={revisions!} />
        <JsonCard draft={draft} />
      </section>
      <Card className="config-secrets">
        <p className="row small muted">
          Aucun secret n’est gardé : ni dans oqas.json, ni dans la base. La configuration nomme les variables d’environnement qui les tiennent, sur la machine
          qui lance les sessions.
        </p>
      </Card>
    </Page>
  );
}
