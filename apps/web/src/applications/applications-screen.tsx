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
 * An application of the configuration in force, as a tile that leads to its page: its name, what it exposes and its
 * identifier, then what it holds — its environments, its APIs, the sources that describe it, its test accounts, none
 * of which said in the tone of a warning.
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
  const accounts = authentication.accounts?.length ?? 0;
  const facts = [
    ["environments", [String(environments.length), ...environments.map(({ name }) => name)].join(" · ")],
    ["apis", String(apis)],
    ["sources", String(sources)],
  ] as const;
  return (
    <a className="tile app-tile" href={hrefTo(applicationPath(application.id))}>
      <span className="tile-head">
        <span className="app-tile-name">
          <b>{application.name === "" ? t("configuration.application.untitled", { rank: rank + 1 }) : application.name}</b>
          <span className="mono">{application.id}</span>
        </span>
        <span className="chip">{t(`configuration.application.types.${application.type}`)}</span>
      </span>
      <dl className="app-tile-facts">
        {facts.map(([fact, value]) => (
          <div key={fact}>
            <dt>{t(`configuration.applications.facts.${fact}`)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div>
          <dt>{t("configuration.applications.facts.accounts")}</dt>
          <dd className={accounts === 0 ? "app-tile-none" : undefined}>{accounts === 0 ? t("configuration.applications.facts.none") : accounts}</dd>
        </div>
      </dl>
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
    <Page crumbs={crumbs} title={title} invite={add} hint={t("configuration.applications.lead")}>
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
