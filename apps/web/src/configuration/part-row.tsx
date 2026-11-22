import type { ReactNode } from "react";
import { t } from "../i18n/i18n.ts";
import { Badge } from "../ui/badge.tsx";

/** What the row of a part of an item is drawn from. */
export interface PartRowProps {
  /** What names the part. */
  readonly name: string;
  /** What the part holds, in a few words. */
  readonly facts?: string;
  /** Whether the part holds an error. */
  readonly wrong: boolean;
  /** The link that opens the panel that changes it. */
  readonly href: string;
}

/**
 * A part of an item of the configuration in a list — a test account, an environment, an attachment —: its name, what
 * it holds, whether it has an error, and the link that changes it in a panel.
 *
 * @param props - The name of the part, its facts, whether it is wrong and its link.
 * @returns The row.
 */
export function PartRow({ name, facts, wrong, href }: PartRowProps): ReactNode {
  return (
    <div className="row part-row">
      <div className="grow">
        <b>{name}</b>
        {facts !== undefined && <div className="small muted">{facts}</div>}
      </div>
      {wrong && <Badge tone="ko">{t("configuration.application.toFix")}</Badge>}
      <a className="btn sm" href={href} aria-label={t("configuration.application.editPart", { name })}>
        {t("configuration.application.edit")}
      </a>
    </div>
  );
}
