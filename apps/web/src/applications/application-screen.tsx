import type { MouseEventHandler, ReactNode } from "react";
import { t } from "../i18n/i18n.ts";
import { hrefTo, type Route } from "../routing/route.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page, type Crumb } from "../ui/page.tsx";
import { applicationTitle } from "../configuration/application-card.tsx";
import type { ConfigurationControls } from "../configuration/configuration-screen.tsx";
import type { ConfigurationState } from "../configuration/configuration-state.ts";
import { DraftForm } from "../configuration/draft-form.tsx";
import { rankIn } from "../configuration/use-item-pages.ts";
import { APPLICATIONS, applicationPath, applicationsOf } from "./application-paths.ts";
import { ApplicationSheet } from "./application-sheet.tsx";

/** What the person does on the page of an application. */
export interface ApplicationControls {
  /** What the person does to the draft of the configuration, which holds the applications. */
  readonly edit: ConfigurationControls;
  /** Removes the application the button names by its rank from the configuration, once the person confirmed it. */
  readonly drop: MouseEventHandler<HTMLButtonElement>;
}

/** What the page of an application is drawn from. */
export interface ApplicationScreenProps {
  /** The name of the project. */
  readonly project: string;
  /** Where the console is: an application, the confirmation of its removal asked, or the application being added. */
  readonly route: Route;
  /** The draft of the configuration. */
  readonly state: ConfigurationState;
  readonly controls: ApplicationControls;
}

/** The confirmation of the removal of an application the person asked for, with the ways out. */
function DropConfirmation({
  id,
  name,
  rank,
  state,
  controls,
}: {
  readonly id: string;
  readonly name: string;
  readonly rank: number;
  readonly state: ConfigurationState;
  readonly controls: ApplicationControls;
}): ReactNode {
  return (
    <section className="config-note warn knowledge-confirm" aria-labelledby="application-drop-title">
      <b id="application-drop-title">{t("configuration.applications.dropTitle", { name })}</b>
      <span>{t("configuration.applications.dropNote")}</span>
      <div className="config-actions">
        <a className="btn" href={hrefTo(applicationPath(id))}>
          {t("configuration.applications.cancel")}
        </a>
        <button type="button" className="btn danger" data-rank={rank} onClick={controls.drop} disabled={state.saving}>
          {t("configuration.applications.confirmDrop")}
        </button>
      </div>
    </section>
  );
}

/**
 * An application of the configuration on a page of its own: what it is, then its test accounts and its environments,
 * each changed in a panel; the person saves it alone, as a revision of its own, or removes it once they confirmed it;
 * or the application they add, saved alone the same way.
 *
 * @param props - The project, the route, the draft and what the person does to it.
 * @returns The page.
 */
export function ApplicationScreen({ project, route, state, controls }: ApplicationScreenProps): ReactNode {
  const [, id] = route.path;
  const crumbs = (label: string): Crumb[] => [{ label: project }, { label: t("configuration.applications.title"), href: hrefTo(APPLICATIONS) }, { label }];
  const { draft, view } = state;
  const back = <a href={hrefTo(APPLICATIONS)}>{t("configuration.applications.back")}</a>;
  if (draft === undefined || view?.revision === undefined)
    return (
      <Page crumbs={crumbs(id ?? t("configuration.applications.new"))} title={id ?? t("configuration.applications.new")}>
        <EmptyState title={t("configuration.applications.reading")} action={back}>
          <span role="status">{state.unread ?? t("configuration.screen.readingNote")}</span>
        </EmptyState>
      </Page>
    );
  if (id === undefined) {
    // The application being added is the last of the draft, once the page added it.
    const rank = view.revision.document.applications.length;
    const application = draft.applications[rank];
    const title = t("configuration.applications.new");
    return (
      <Page crumbs={crumbs(title)} title={title}>
        {application !== undefined && (
          <DraftForm state={state} controls={controls.edit}>
            <ApplicationSheet application={application} rank={rank} route={route} state={state} controls={controls.edit} />
          </DraftForm>
        )}
      </Page>
    );
  }
  const rank = rankIn(view, applicationsOf, id);
  if (rank === undefined)
    return (
      <Page crumbs={crumbs(id)} title={id}>
        <EmptyState title={t("configuration.applications.unknown")} action={back}>
          <span role="status">{t("configuration.applications.unknownNote")}</span>
        </EmptyState>
      </Page>
    );
  const application = draft.applications[rank]!;
  const name = applicationTitle(view.revision.document.applications[rank]!, rank);
  const drop = (
    <a className="btn ghost" href={hrefTo(applicationPath(id), { drop: "application" })}>
      {t("configuration.applications.drop")}
    </a>
  );
  return (
    <Page crumbs={crumbs(name)} title={name} actions={drop}>
      {route.query["drop"] !== undefined && <DropConfirmation id={id} name={name} rank={rank} state={state} controls={controls} />}
      <DraftForm state={state} controls={controls.edit}>
        <ApplicationSheet application={application} rank={rank} route={route} state={state} controls={controls.edit} />
      </DraftForm>
    </Page>
  );
}
