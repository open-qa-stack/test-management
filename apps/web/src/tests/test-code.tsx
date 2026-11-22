import type { ReactNode } from "react";
import type { PolledState } from "../api/polled-state.ts";
import { t } from "../i18n/i18n.ts";
import { Card } from "../ui/card.tsx";
import { Code } from "../ui/code.tsx";

/**
 * The code of the file of a test, folded: a person who does not read code sees its steps first, and opens it when
 * they want to.
 *
 * @param props - What the instance told of the text of the file.
 * @returns The card.
 */
export function TestCode({ source }: { readonly source: PolledState<string> }): ReactNode {
  return (
    <Card title={t("test.code")} hint={t("test.codeHint")}>
      <details className="test-code">
        <summary className="row">{t("test.codeShow")}</summary>
        {source.value === undefined ? (
          <p className="row small muted" role="status">
            {source.unread ?? t("test.codeReading")}
          </p>
        ) : (
          <Code lines={source.value.trimEnd().split("\n")} className="test-code-lines" />
        )}
      </details>
    </Card>
  );
}
