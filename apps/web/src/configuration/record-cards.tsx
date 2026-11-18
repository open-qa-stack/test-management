import type { ReactNode } from "react";
import type { OqasConfig, RevisionSummary } from "@open-qa-stack/domain/sessions";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { dateText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { originText } from "./configuration-words.ts";

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
