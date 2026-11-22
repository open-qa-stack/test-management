import type { ReactNode } from "react";
import { sourceApplications, type ConfiguredApplication } from "@open-qa-stack/domain/sessions";
import type { ConfigurationState } from "../configuration/configuration-state.ts";
import { t } from "../i18n/i18n.ts";
import { hrefTo, type Route } from "../routing/route.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { APPLICATIONS, applicationPath } from "./application-paths.ts";
import { ApplicationScreen, type ApplicationControls } from "./application-screen.tsx";

/**
 * An application of the configuration in force, as a tile that leads to its page: its name and what it exposes, what
 * it holds — environments, APIs, test accounts — and how many sources describe it, then its identifier.
 */
function ApplicationTile({
  application,
  rank,
  sources,
}: {
  readonly application: ConfiguredApplication;
  readonly rank: number;
  readonly sources: number;
}): ReactNode {
  const { environments, authentication } = application;
  const apis = environments.reduce((count, environment) => count + (environment.apis?.length ?? 0), 0);
  const holds = [
    t("configuration.applications.environments", { count: environments.length }),
    t("configuration.applications.apis", { count: apis }),
    t("configuration.applications.accounts", { count: authentication.accounts?.length ?? 0 }),
  ];
  return (
    <a className="tile" href={hrefTo(applicationPath(application.id))}>
      <span className="tile-head">
        <b>{application.name === "" ? t("configuration.application.untitled", { rank: rank + 1 }) : application.name}</b>
      </span>
      <span className="tile-text">{[t(`configuration.application.types.${application.type}`), ...holds].join(" · ")}</span>
      <span className="tile-text">{t("configuration.applications.sources", { count: sources })}</span>
      <span className="tile-text mono">{application.id}</span>
    </a>
  );
}

/** The applications of the configuration in force, each a tile that leads to its page, and the button that adds one. */
function ApplicationList({ project, state }: { readonly project: string; readonly state: ConfigurationState }): ReactNode {
  const title = t("configuration.applications.title");
  const crumbs = [{ label: project }, { label: title }];
  const revision = state.view?.revision;
  if (state.view === undefined)
    return (
      <Page crumbs={crumbs} title={title}>
        <EmptyState title={t("configuration.applications.reading")}>
          <span role="status">{state.unread ?? t("configuration.screen.readingNote")}</span>
        </EmptyState>
      </Page>
    );
  if (revision === undefined)
    return (
      <Page crumbs={crumbs} title={title}>
        <EmptyState
          title={t("configuration.applications.none")}
          action={
            <a className="btn primary" href={hrefTo("/configuration")}>
              {t("configuration.applications.configure")}
            </a>
          }
        >
          {t("configuration.applications.noneNote")}
        </EmptyState>
      </Page>
    );
  const add = (
    <a className="btn primary" href={hrefTo(APPLICATIONS, { add: "application" })}>
      {t("configuration.applications.add")}
    </a>
  );
  return (
    <Page crumbs={crumbs} title={title} actions={add} hint={t("configuration.applications.lead")}>
      <div className="tiles">
        {revision.document.applications.map((application, index) => (
          <ApplicationTile
            key={index}
            application={application}
            rank={index}
            sources={revision.document.knowledge.filter((source) => sourceApplications(source).includes(application.id)).length}
          />
        ))}
      </div>
    </Page>
  );
}

/**
 * The applications of the project: their list, the page of one, or the application the person adds.
 *
 * @param props - The project, the route, the draft of the configuration and what the person does to it.
 * @returns The screen of the route.
 */
export function ApplicationsScreen(props: {
  readonly project: string;
  readonly route: Route;
  readonly state: ConfigurationState;
  readonly controls: ApplicationControls;
}): ReactNode {
  const [, id] = props.route.path;
  return id === undefined && props.route.query["add"] === undefined ? (
    <ApplicationList project={props.project} state={props.state} />
  ) : (
    <ApplicationScreen {...props} />
  );
}
