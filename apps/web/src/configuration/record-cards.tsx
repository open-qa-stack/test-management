import type { ReactNode } from "react";
import type { Knowledge, OqasConfig, RevisionSummary } from "@open-qa-stack/domain/sessions";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { dateText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { originText } from "./configuration-words.ts";

/** Where a source is read from: its address, its file, its container, the variable of its connection or the instance, never a secret. */
function whereOf(source: Knowledge): string {
  if (source.type === "postgresql") return t("configuration.records.variable", { name: source.connectionStringEnv });
  if (source.type === "openapi") return source.url ?? source.path;
  if (source.type === "logs") return source.path ?? t("configuration.records.container", { name: source.container });
  return source.path ?? t("configuration.records.stored");
}

/**
 * The knowledge sources of the configuration, read only: their edition comes in a later version.
 *
 * @param props - The sources of the draft.
 * @returns Their card.
 */
export function KnowledgeCard({ knowledge }: { readonly knowledge: readonly Knowledge[] }): ReactNode {
  return (
    <Card
      title={t("configuration.records.knowledge")}
      hint={t("configuration.records.readOnly")}
      aside={<Badge tone="outline">{t("configuration.records.soon")}</Badge>}
    >
      <p className="row small muted">{t("configuration.records.knowledgeNote")}</p>
      {knowledge.length === 0 && <EmptyState title={t("configuration.records.noKnowledge")} />}
      {knowledge.map((source) => (
        <div key={source.id} className="row config-record">
          <div className="grow">
            <b className="mono">{source.id}</b>
            <div className="small muted">
              {t(`configuration.records.kinds.${source.type}`)} · <span className="mono">{whereOf(source)}</span>
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
    <Card title={t("configuration.records.history")} hint={t("configuration.records.latestFirst")}>
      <ol className="config-history">
        {revisions.map((revision, index) => (
          <li key={revision.number} className="row config-record">
            <div className="grow">
              <b>{t("configuration.records.revision", { number: revision.number })}</b>
              <div className="small muted">
                {originText(revision.origin)} · <time dateTime={revision.recordedAt}>{dateText(revision.recordedAt)}</time>
              </div>
            </div>
            {index === 0 && <Badge tone="ok">{t("configuration.records.inForce")}</Badge>}
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
    <Card title={t("configuration.records.json")} hint={t("configuration.records.readOnly")}>
      <details className="config-json">
        <summary>{t("configuration.records.seeJson")}</summary>
        <pre className="mono">{JSON.stringify(draft, null, 2)}</pre>
      </details>
    </Card>
  );
}
