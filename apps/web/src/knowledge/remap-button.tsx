import type { MouseEventHandler, ReactNode } from "react";
import { t } from "../i18n/i18n.ts";
import type { RemapRequest } from "./knowledge-state.ts";

/** What the last request to map the knowledge again tells: the wait, what came of it, or why it failed. */
function RemapNote({ remap, all }: { readonly remap: RemapRequest; readonly all: boolean }): ReactNode {
  if (remap.failure !== undefined)
    return (
      <p className="config-note ko" role="status">
        {t("knowledge.remap.failed", { reason: remap.failure })}
      </p>
    );
  const { outcome } = remap;
  if (outcome === undefined)
    return (
      <p className="small muted" role="status">
        {t("knowledge.remap.sending")}
      </p>
    );
  return (
    <p className={outcome.state === "unknown" ? "config-note ko" : "config-note ok"} role="status">
      {outcome.state === "opened" ? t(all ? "knowledge.remap.openedAll" : "knowledge.remap.opened") : t(`knowledge.remap.${outcome.state}`)}
    </p>
  );
}

/**
 * The button that maps the knowledge again — the source named, or every source —, and what its last request told:
 * a session maps it, or one maps it already.
 *
 * @param props - The source, none for every source; the last request; and what asks the instance.
 * @returns The button, and what the last request of the same source told.
 */
export function RemapButton({
  source,
  remap,
  onRemap,
}: {
  readonly source?: string;
  readonly remap: RemapRequest | undefined;
  readonly onRemap: MouseEventHandler<HTMLButtonElement>;
}): ReactNode {
  const shown = remap !== undefined && remap.source === source ? remap : undefined;
  const sending = shown !== undefined && shown.outcome === undefined && shown.failure === undefined;
  return (
    <div className="remap">
      <button type="button" className="btn sm" data-source={source} onClick={onRemap} disabled={sending}>
        {t(source === undefined ? "knowledge.remap.all" : "knowledge.remap.one")}
      </button>
      {shown !== undefined && <RemapNote remap={shown} all={source === undefined} />}
    </div>
  );
}
