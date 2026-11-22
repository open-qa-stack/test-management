import type { ChangeEventHandler, FormEventHandler, ReactNode } from "react";
import type { CartographyState, KnowledgeDomain, MappingState } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { IndexLine, MAPPING_TONES } from "../knowledge/knowledge-screen.tsx";
import { hrefTo } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";

/** Where the opening of the session the person asked for is. */
export type DiscoveryOpening = { readonly state: "idle" } | { readonly state: "opening" } | { readonly state: "refused"; readonly text: string };

/** What the person does on the screen. */
export interface DiscoveryControls {
  /** Picks or leaves a domain, which its box names. */
  readonly toggle: ChangeEventHandler<HTMLInputElement>;
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
          <IndexLine mapping={mapping} />
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
 * The discovery of the project: what the cartography found in its knowledge — the sources and where each stands, the
 * domains — and what writes the tests of the domains the person picks, a session kept to them.
 *
 * @param props - The project, what the instance told, what the person picked and what they do.
 * @returns The screen.
 */
export function DiscoveryScreen({ project, mapping, domains, unread, chosen, opening, controls }: DiscoveryScreenProps): ReactNode {
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
      ) : (
        <form className="discovery-form" onSubmit={controls.generate}>
          <fieldset className="tiles">
            <legend className="sr-only">{t("discovery.domains")}</legend>
            {domains.map((domain) => (
              <label key={domain.id} className="tile" htmlFor={`domain-${domain.id}`}>
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
            ))}
          </fieldset>
          {opening.state === "refused" && (
            <p className="config-note ko" role="alert">
              {opening.text}
            </p>
          )}
          <div className="action-bar">
            <span className="small muted" role="status">
              {t("discovery.picked", { count: chosen.size, total: domains.length })}
            </span>
            <button type="submit" className="btn primary" disabled={chosen.size === 0 || opening.state === "opening"}>
              {opening.state === "opening" ? t("discovery.opening") : t("discovery.generate", { count: chosen.size })}
            </button>
          </div>
        </form>
      )}
      {/* What the person decides comes first; where each source stands follows, as what the domains come from. */}
      <Sources mapping={mapping} />
    </Page>
  );
}
