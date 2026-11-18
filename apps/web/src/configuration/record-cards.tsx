import type { ReactNode } from "react";
import type { Knowledge, OqasConfig, RevisionSummary } from "@open-qa-stack/domain/sessions";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { dateText, ORIGINS } from "./configuration-words.ts";

/** What each kind of knowledge source is, in words. */
const KINDS: Readonly<Record<Knowledge["type"], string>> = {
  openapi: "Contrat OpenAPI",
  postgresql: "Base PostgreSQL",
  document: "Document",
  "source-code": "Code source",
  logs: "Journaux",
};

/** Where a source is read from: its address, its file, its container or the variable of its connection, never a secret. */
function whereOf(source: Knowledge): string {
  if (source.type === "postgresql") return `variable ${source.connectionStringEnv}`;
  if (source.type === "openapi") return source.url ?? source.path;
  if (source.type === "logs") return source.path ?? `conteneur ${source.container}`;
  return source.path;
}

/**
 * The knowledge sources of the configuration, read only: their edition comes in a later version.
 *
 * @param props - The sources of the draft.
 * @returns Their card.
 */
export function KnowledgeCard({ knowledge }: { readonly knowledge: readonly Knowledge[] }): ReactNode {
  return (
    <Card title="Connaissances" hint="en lecture seule" aside={<Badge tone="outline">bientôt modifiables</Badge>}>
      <p className="row small muted">
        Leur édition dans la console arrive dans un prochain lot ; d’ici là, elles se déclarent dans oqas.json, et la console les reprend.
      </p>
      {knowledge.length === 0 && <EmptyState title="Aucune source de connaissance" />}
      {knowledge.map((source) => (
        <div key={source.id} className="row config-record">
          <div className="grow">
            <b className="mono">{source.id}</b>
            <div className="small muted">
              {KINDS[source.type]} · <span className="mono">{whereOf(source)}</span>
            </div>
          </div>
          <span className="small muted">
            {source.attachments.map((attachment) => [attachment.application, attachment.environment, attachment.api].filter(Boolean).join(" › ")).join(", ")}
          </span>
        </div>
      ))}
    </Card>
  );
}

/**
 * The history of the configuration: every revision, the latest first, with where it comes from.
 *
 * @param props - The revisions.
 * @returns Its card.
 */
export function HistoryCard({ revisions }: { readonly revisions: readonly RevisionSummary[] }): ReactNode {
  return (
    <Card title="Historique des révisions" hint="la plus récente d’abord">
      <ol className="config-history">
        {revisions.map((revision, index) => (
          <li key={revision.number} className="row config-record">
            <div className="grow">
              <b>Révision {revision.number}</b>
              <div className="small muted">
                {ORIGINS[revision.origin]} · <time dateTime={revision.recordedAt}>{dateText(revision.recordedAt)}</time>
              </div>
            </div>
            {index === 0 && <Badge tone="ok">en vigueur</Badge>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/**
 * The configuration as JSON, read only, as the draft holds it.
 *
 * @param props - The draft.
 * @returns Its card.
 */
export function JsonCard({ draft }: { readonly draft: OqasConfig }): ReactNode {
  return (
    <Card title="JSON" hint="en lecture seule">
      <details className="config-json">
        <summary>Voir la configuration en JSON</summary>
        <pre className="mono">{JSON.stringify(draft, null, 2)}</pre>
      </details>
    </Card>
  );
}
