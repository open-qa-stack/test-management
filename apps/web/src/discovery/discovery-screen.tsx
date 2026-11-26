import type { ChangeEventHandler, FormEventHandler, MouseEventHandler, ReactNode } from "react";
import type { CartographyState, KnowledgeDomain, MappingState } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { KnowledgeBaseLine, MAPPING_TONES } from "../knowledge/knowledge-screen.tsx";
import { hrefTo, withPanel, type Route } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
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
  const marks = [...new Set(domain.sources.flatMap((source) => reach(source.applications)))];
  return (
    <div className="domain-sources small">
      <span className="domain-marks">
        {marks.map((mark) => (
          <Badge key={mark} tone="neutral" square>
            {mark}
          </Badge>
        ))}
      </span>
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

/** The domains a person excluded, apart, each to take back. */
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
        <form className="discovery-form" onSubmit={controls.generate}>
          <fieldset className="tiles">
            <legend className="sr-only">{t("discovery.domains")}</legend>
            {kept.map((domain) => (
              <div key={domain.id} className="tile">
                <label className="tile-pick" htmlFor={`domain-${domain.id}`}>
                  <span className="tile-head">
                    <b>{domain.label}</b>
                    <input
                      id={`domain-${domain.id}`}
                      type="checkbox"
                      name="domain"
                      value={domain.id}
                      checked={chosen.has(domain.id)}
                      onChange={controls.toggle}
                    />
                  </span>
                  <span className="tile-text">{domain.description}</span>
                </label>
                <DomainSources domain={domain} />
                <div className="domain-actions">
                  <a className="btn sm" href={withPanel(route, `rename:${domain.id}`)} aria-label={t("discovery.renameOne", { label: domain.label })}>
                    {t("discovery.rename")}
                  </a>
                  <button
                    type="button"
                    className="btn sm"
                    value={domain.id}
                    disabled={changing.pending}
                    onClick={controls.exclude}
                    aria-label={t("discovery.excludeOne", { label: domain.label })}
                  >
                    {t("discovery.exclude")}
                  </button>
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
            <span className="small muted" role="status">
              {t("discovery.picked", { count: chosen.size, total: kept.length })}
            </span>
            <button type="submit" className="btn primary" disabled={chosen.size === 0 || opening.state === "opening"}>
              {opening.state === "opening" ? t("discovery.opening") : t("discovery.generate", { count: chosen.size })}
            </button>
          </div>
        </form>
      )}
      {renamed === undefined && changing.refusal !== undefined && (
        <p className="config-note ko" role="alert">
          {changing.refusal}
        </p>
      )}
      <Excluded domains={domains.filter(({ excluded }) => excluded === true)} changing={changing} restore={controls.restore} />
      {renamed !== undefined && <RenamePanel key={renamed.id} domain={renamed} close={withPanel(route)} changing={changing} onRename={controls.rename} />}
      {/* What the person decides comes first; where each source stands follows, as what the domains come from. */}
      <Sources mapping={mapping} />
    </Page>
  );
}
