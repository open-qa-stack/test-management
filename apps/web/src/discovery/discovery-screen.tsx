import type { ChangeEventHandler, FormEventHandler, MouseEventHandler, ReactNode } from "react";
import type { CartographyState, KnowledgeDomain, MappingState } from "@open-qa-stack/domain/sessions";
import { dateText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { KnowledgeBaseLine, MAPPING_TONES } from "../knowledge/knowledge-screen.tsx";
import { hrefTo, withPanel, type Route } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Icon } from "../ui/icon.tsx";
import { Page } from "../ui/page.tsx";
import { RenamePanel } from "./rename-panel.tsx";

/** Where the opening of the session the person asked for is. */
export type DiscoveryOpening = { readonly state: "idle" } | { readonly state: "opening" } | { readonly state: "refused"; readonly text: string };

/** Where a change of a domain is: going on, or refused with why. */
export interface DomainChanging {
  readonly pending: boolean;
  readonly refusal?: string;
}

/** What the person does on the screen. */
export interface DiscoveryControls {
  /** Picks or leaves a domain, which its box names. */
  readonly toggle: ChangeEventHandler<HTMLInputElement>;
  /** Picks every domain shown that can be, or none once all are. */
  readonly chooseAll: MouseEventHandler<HTMLButtonElement>;
  /** Narrows the domains to the words of the search form. */
  readonly search: FormEventHandler<HTMLFormElement>;
  /** Excludes the domain the button names. */
  readonly exclude: MouseEventHandler<HTMLButtonElement>;
  /** Takes back the domain the button names. */
  readonly restore: MouseEventHandler<HTMLButtonElement>;
  /** Renames the domain of the panel. */
  readonly rename: FormEventHandler<HTMLFormElement>;
  /** Opens a session that writes the tests of the domains picked. */
  readonly generate: FormEventHandler<HTMLFormElement>;
}

/** What the screen of the discovery is drawn from. */
export interface DiscoveryScreenProps {
  readonly project: string;
  /** Where the cartography of the knowledge stands; none before the instance told it. */
  readonly mapping?: CartographyState;
  /** The domains the cartography found; none before the instance told them. */
  readonly domains?: readonly KnowledgeDomain[];
  /** Why the instance could not tell them. */
  readonly unread?: string;
  /** The identifiers of the domains the person picked. */
  readonly chosen: ReadonlySet<string>;
  readonly opening: DiscoveryOpening;
  /** Where the console is, which tells the domain being renamed. */
  readonly route: Route;
  readonly changing: DomainChanging;
  readonly controls: DiscoveryControls;
}

/** The states of a cartography, in the order a source goes through them. */
/**
 * The domains a person can pick that hold every word of a search, in their name or what they are about, case aside.
 *
 * @param domains - The domains the cartography found.
 * @param search - The words of the search; every domain for none.
 * @returns Those not excluded that match it, in their order.
 */
export function shownDomains(domains: readonly KnowledgeDomain[], search: string): readonly KnowledgeDomain[] {
  const words = search
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
  return domains.filter(
    ({ excluded, label, description }) => excluded !== true && words.every((word) => `${label} ${description}`.toLowerCase().includes(word)),
  );
}

const STATES: readonly MappingState[] = ["mapped", "truncated", "mapping", "waiting"];

/**
 * The sources of the knowledge as a summary — how many stand in each state of their cartography, then when the
 * knowledge was put together —, each source folded under it.
 */
function Sources({ mapping }: { readonly mapping: CartographyState }): ReactNode {
  const { sources } = mapping;
  return (
    <Card title={t("discovery.sources")} hint={t("discovery.sourceCount", { count: sources.length })}>
      {sources.length === 0 ? (
        <EmptyState title={t("discovery.noSource")} />
      ) : (
        <div className="row discovery-summary">
          {STATES.map((state) => [state, sources.filter((source) => source.state === state).length] as const)
            .filter(([, count]) => count > 0)
            .map(([state, count]) => (
              <Badge key={state} tone={MAPPING_TONES[state]}>
                {t(`knowledge.mapping.${state}`)} · {count}
              </Badge>
            ))}
          <KnowledgeBaseLine mapping={mapping} />
        </div>
      )}
      {sources.length > 0 && (
        <details className="discovery-sources">
          <summary className="row small">{t("discovery.seeSources")}</summary>
          {sources.map((source) => (
            <div key={source.id} className="row">
              <span className="grow">{source.id}</span>
              <Badge tone={MAPPING_TONES[source.state]}>{t(`knowledge.mapping.${source.state}`)}</Badge>
            </div>
          ))}
        </details>
      )}
    </Card>
  );
}

/**
 * Where a domain comes from: the applications its sources describe — the whole project for a source attached to none —,
 * then, folded, each source with its applications and what the cartography placed of it in the domain.
 */
function DomainSources({ domain }: { readonly domain: KnowledgeDomain }): ReactNode {
  const reach = (applications: readonly string[]) => (applications.length === 0 ? [t("knowledge.project")] : applications);
  const applications = new Set(domain.sources.flatMap((source) => source.applications));
  return (
    <div className="domain-sources small">
      <span className="muted">{t("discovery.applications", { count: applications.size })}</span>
      <details>
        <summary>{t("discovery.domainSources", { count: domain.sources.length })}</summary>
        <ul>
          {domain.sources.map((source) => (
            <li key={source.id}>
              <b>{source.id}</b> · {reach(source.applications).join(", ")} — <span className="muted">{source.items.join(", ")}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** What a person sets of a domain, in a list that unfolds at the foot of its card: its name, and whether it is excluded. */
function DomainMore({
  domain,
  route,
  changing,
  exclude,
}: {
  readonly domain: KnowledgeDomain;
  readonly route: Route;
  readonly changing: DomainChanging;
  readonly exclude: DiscoveryControls["exclude"];
}): ReactNode {
  return (
    <details className="domain-more">
      <summary aria-label={t("discovery.moreOne", { label: domain.label })} title={t("discovery.more")}>
        <Icon name="more" />
      </summary>
      <div className="domain-more-items">
        <a className="btn ghost sm" href={withPanel(route, `rename:${domain.id}`)} aria-label={t("discovery.renameOne", { label: domain.label })}>
          {t("discovery.rename")}
        </a>
        <button
          type="button"
          className="btn ghost sm"
          value={domain.id}
          disabled={changing.pending}
          onClick={exclude}
          aria-label={t("discovery.excludeOne", { label: domain.label })}
        >
          {t("discovery.exclude")}
        </button>
      </div>
    </details>
  );
}

function Excluded({
  domains,
  changing,
  restore,
}: {
  readonly domains: readonly KnowledgeDomain[];
  readonly changing: DomainChanging;
  readonly restore: DiscoveryControls["restore"];
}): ReactNode {
  if (domains.length === 0) return null;
  return (
    <Card title={t("discovery.excluded")} hint={t("discovery.excludedNote")}>
      {domains.map(({ id, label, description }) => (
        <div key={id} className="row">
          <div className="grow">
            <b>{label}</b>
            <div className="small muted">{description}</div>
          </div>
          <button type="button" className="btn" value={id} disabled={changing.pending} onClick={restore}>
            {t("discovery.restore")}
          </button>
        </div>
      ))}
    </Card>
  );
}

/**
 * The discovery of the project: what the cartography found in its knowledge — the sources and where each stands, the
 * domains, which the person may rename or exclude — and what writes the tests of the domains the person picks, a session kept to them.
 *
 * @param props - The project, what the instance told, what the person picked and what they do.
 * @returns The screen.
 */
export function DiscoveryScreen({ project, mapping, domains, unread, chosen, opening, route, changing, controls }: DiscoveryScreenProps): ReactNode {
  const title = t("discovery.title");
  const crumbs = [{ label: project }, { label: title }];
  if (mapping === undefined || domains === undefined)
    return (
      <Page crumbs={crumbs} title={title}>
        <EmptyState title={t("discovery.reading")}>
          <span role="status">{unread ?? t("discovery.readingNote")}</span>
        </EmptyState>
      </Page>
    );
  const kept = domains.filter(({ excluded }) => excluded !== true);
  const search = route.query["q"] ?? "";
  const shown = shownDomains(domains, search);
  const renamed = domains.find(({ id }) => `rename:${id}` === route.query["panel"]);
  return (
    <Page crumbs={crumbs} title={title} hint={t("discovery.lead")}>
      {domains.length === 0 ? (
        <EmptyState
          title={t("discovery.noDomain")}
          action={
            <a className="btn" href={hrefTo("/knowledge")}>
              {t("discovery.openKnowledge")}
            </a>
          }
        >
          {t("discovery.noDomainNote")}
        </EmptyState>
      ) : kept.length === 0 ? (
        <EmptyState title={t("discovery.allExcluded")} />
      ) : (
        <>
          <form id="discovery-search" role="search" onSubmit={controls.search} />
          <form className="discovery-form" onSubmit={controls.generate}>
            <div className="discovery-toolbar">
              <input
                type="search"
                form="discovery-search"
                name="q"
                defaultValue={search}
                aria-label={t("discovery.search")}
                placeholder={t("discovery.search")}
              />
              <button type="button" className="chip" onClick={controls.chooseAll}>
                {t(shown.length > 0 && shown.every(({ id }) => chosen.has(id)) ? "discovery.chooseNone" : "discovery.chooseAll")}
              </button>
              <span className="small muted">
                {mapping.knowledgeBase === undefined
                  ? t("discovery.overview", { count: kept.length, sources: mapping.sources.length })
                  : t("discovery.overviewOn", { count: kept.length, sources: mapping.sources.length, date: dateText(mapping.knowledgeBase.producedAt) })}
                {" · "}
                <a href={hrefTo("/knowledge")}>{t("discovery.seeSources")}</a>
              </span>
            </div>
            <fieldset className="tiles">
              <legend className="sr-only">{t("discovery.domains")}</legend>
              {shown.length === 0 && <EmptyState title={t("discovery.noMatch")}>{t("discovery.noMatchNote")}</EmptyState>}
              {shown.map((domain) => (
                <div key={domain.id} className={chosen.has(domain.id) ? "tile on" : "tile"}>
                  <label className="tile-pick" htmlFor={`domain-${domain.id}`}>
                    <span className="tile-head">
                      <input
                        id={`domain-${domain.id}`}
                        type="checkbox"
                        name="domain"
                        value={domain.id}
                        checked={chosen.has(domain.id)}
                        onChange={controls.toggle}
                      />
                      <b>{domain.label}</b>
                    </span>
                    <span className="tile-text">{domain.description}</span>
                  </label>
                  <div className="domain-foot">
                    <DomainSources domain={domain} />
                    <DomainMore domain={domain} route={route} changing={changing} exclude={controls.exclude} />
                  </div>
                </div>
              ))}
            </fieldset>
            {opening.state === "refused" && (
              <p className="config-note ko" role="alert">
                {opening.text}
              </p>
            )}
            <div className="action-bar">
              <span className="discovery-picked" role="status">
                <b>{t("discovery.picked", { count: chosen.size, total: kept.length })}</b>
                {chosen.size > 0 && (
                  <span className="small muted">
                    {kept
                      .filter(({ id }) => chosen.has(id))
                      .map(({ label }) => label)
                      .join(", ")}
                  </span>
                )}
              </span>
              <button type="submit" className="btn primary" disabled={chosen.size === 0 || opening.state === "opening"}>
                {opening.state === "opening" ? t("discovery.opening") : t("discovery.generate")}
              </button>
            </div>
          </form>
        </>
      )}
      {renamed === undefined && changing.refusal !== undefined && (
        <p className="config-note ko" role="alert">
          {changing.refusal}
        </p>
      )}
      <Excluded domains={domains.filter(({ excluded }) => excluded === true)} changing={changing} restore={controls.restore} />
      {renamed !== undefined && <RenamePanel key={renamed.id} domain={renamed} close={withPanel(route)} changing={changing} onRename={controls.rename} />}
      {/* Before any domain, where each source stands tells what the cartography does. */}
      {domains.length === 0 && <Sources mapping={mapping} />}
    </Page>
  );
}
