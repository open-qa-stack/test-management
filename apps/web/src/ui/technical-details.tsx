import type { ReactNode } from "react";
import { t } from "../i18n/i18n.ts";

/**
 * What only a technical reader needs — a path, an address, a variable, a version of the repository — folded under
 * « Technical details », so that a screen speaks to everyone first.
 *
 * @param props - What the fold holds.
 * @returns The fold.
 */
export function TechnicalDetails({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <details className="config-advanced technical-details">
      <summary>{t("technicalDetails")}</summary>
      <div className="small muted">{children}</div>
    </details>
  );
}
