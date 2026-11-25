import type { ReactNode } from "react";
import type { TestLaunch } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";

/** How far a launch that runs went: that its tests are prepared, then how many ended among them, with a bar. */
export function LaunchAdvance({ launch: { progress } }: { readonly launch: TestLaunch }): ReactNode {
  if (progress?.total === undefined) return <span className="small muted">{t("running.preparing")}</span>;
  const { total, finished } = progress;
  return (
    <span className="exec-advance small">
      <progress max={total} value={finished.length} aria-label={t("running.badge")} />
      {t("running.progress", { finished: finished.length, total })}
    </span>
  );
}
