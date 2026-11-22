import type { MouseEventHandler, ReactNode } from "react";
import type { FileState, OqasConfig, RevisionSummary } from "@open-qa-stack/domain/sessions";
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

/** What the card of the file needs. */
export interface FileCardProps {
  /** How the configuration file stands to the revision in force. */
  readonly file: FileState;
  /** Whether something is being saved: the buttons wait. */
  readonly saving: boolean;
  readonly controls: { readonly takeFile: MouseEventHandler<HTMLButtonElement>; readonly writeFile: MouseEventHandler<HTMLButtonElement> };
}

/**
 * The configuration file of the test repository, a copy of the configuration kept with the tests in git: how it stands
 * to the revision in force, written from it, or taken as it when it differs.
 *
 * @param props - How the file stands, whether something is being saved, and what writes or takes it.
 * @returns Its card.
 */
export function FileCard({ file, saving, controls }: FileCardProps): ReactNode {
  return (
    <Card title={t("configuration.records.file")} hint={t("configuration.records.fileHint")}>
      <p className="row small">{t(`configuration.records.fileStates.${file}`)}</p>
      {file !== "in_step" && (
        <div className="config-actions">
          <button type="button" className="btn" onClick={controls.writeFile} disabled={saving}>
            {t("configuration.records.writeFile")}
          </button>
          {file === "changed" && (
            <button type="button" className="btn" onClick={controls.takeFile} disabled={saving}>
              {t("configuration.records.takeFile")}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
