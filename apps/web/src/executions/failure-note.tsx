import type { ReactNode } from "react";
import type { ExecutionFailure } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";

/**
 * Where a test failed and why, in a line under its title: the step that failed, then what its assertion expected and
 * received, or else the first line of its error.
 *
 * @param props - The failure, as the execution keeps it; none for a test that did not fail or whose failure is not known.
 * @returns The line; nothing without a failure.
 */
export function FailureNote({ failure }: { readonly failure: ExecutionFailure | undefined }): ReactNode {
  if (failure === undefined) return null;
  const { step, message, expected, received } = failure;
  const why = expected === undefined ? message : t("executions.failure.expected", { expected, received });
  return (
    <div className="exec-failure small">
      {step !== undefined && <span className="exec-failure-step">{t("executions.failure.step", step)}</span>}
      {why !== undefined && <span className="mono">{why}</span>}
    </div>
  );
}
