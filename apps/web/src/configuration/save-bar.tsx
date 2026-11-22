import type { MouseEventHandler, ReactNode } from "react";
import { t } from "../i18n/i18n.ts";

/** What the bar that saves a form tells and does. */
export interface SaveBarProps {
  /** Whether the instance is saving the draft. */
  readonly saving: boolean;
  /** Whether the draft holds a change not saved. */
  readonly pending: boolean;
  /** What the bar says when nothing waits to be saved. */
  readonly saved: string;
  /** Drops the change. */
  readonly discard: MouseEventHandler<HTMLButtonElement>;
}

/**
 * The bar at the foot of a form, inside it: what became of the change, and, once there is one, what drops it and what
 * saves it — the one action of the bar —, which then stays in sight while the person fills the form.
 *
 * @param props - The state of the draft and what drops it.
 * @returns The bar.
 */
export function SaveBar({ saving, pending, saved, discard }: SaveBarProps): ReactNode {
  const changed = pending || saving;
  return (
    <div className={changed ? "action-bar save-bar" : "save-bar"}>
      <span className="small muted save-state" role="status">
        {saving ? t("configuration.screen.saving") : pending ? t("configuration.screen.unsaved") : saved}
      </span>
      {changed && (
        <>
          <button type="button" className="btn ghost" onClick={discard} disabled={saving}>
            {t("configuration.screen.discard")}
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {t("configuration.screen.save")}
          </button>
        </>
      )}
    </div>
  );
}
