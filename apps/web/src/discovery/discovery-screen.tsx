import type { ChangeEventHandler, FormEventHandler, ReactNode } from "react";
import type { CartographyState, KnowledgeDomain } from "@open-qa-stack/domain/sessions";
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

/** The sources of the knowledge and where the cartography of each stands, then when the knowledge was put together. */
function Sources({ mapping }: { readonly mapping: CartographyState }): ReactNode {
  return (
    <Card title={t("discovery.sources")}>
      {mapping.sources.length === 0 && <EmptyState title={t("discovery.noSource")} />}
      {mapping.sources.map((source) => (
        <div key={source.id} className="row">
          <b className="grow mono">{source.id}</b>
          <Badge tone={MAPPING_TONES[source.state]}>{t(`knowledge.mapping.${source.state}`)}</Badge>
        </div>
      ))}
      <div className="row">
        <IndexLine mapping={mapping} />
      </div>
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
    <Page crumbs={crumbs} title={title}>
      <p className="small muted">{t("discovery.lead")}</p>
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
        <form onSubmit={controls.generate}>
          <Card title={t("discovery.domains")} hint={t("discovery.domainsHint", { count: domains.length })}>
            <fieldset className="config-body config-group">
              <legend className="sr-only">{t("discovery.domains")}</legend>
              {domains.map((domain) => (
                <label key={domain.id} className="check" htmlFor={`domain-${domain.id}`}>
                  <input
                    id={`domain-${domain.id}`}
                    type="checkbox"
                    name="domain"
                    value={domain.id}
                    checked={chosen.has(domain.id)}
                    onChange={controls.toggle}
                  />
                  <span>
                    {domain.label}
                    <span className="field-hint"> — {domain.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </Card>
          {opening.state === "refused" && (
            <p className="config-note ko" role="alert">
              {opening.text}
            </p>
          )}
          <div className="config-actions">
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
