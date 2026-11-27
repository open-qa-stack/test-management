import type { FormEventHandler, ReactNode } from "react";
import { DEFECT_SEVERITIES, MAX_DEFECT_DESCRIPTION, MAX_DEFECT_TITLE, type TestExecution } from "@open-qa-stack/domain/sessions";
import { dateText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { SidePanel } from "../ui/side-panel.tsx";

/** The identifier of the form of the panel, which its foot submits. */
const FORM = "defect-report";

/** Where the reporting of a defect stands: under way, or refused with why. */
export interface DefectReporting {
  readonly pending: boolean;
  readonly refusal?: string;
}

/**
 * What the harness writes of a failure for the description of a defect: the step it failed at, its error, what it
 * expected and received, and the execution, each on a line.
 *
 * @param latest - The execution the test failed in.
 * @returns The description.
 */
export function failureDescription({ id, ranAt, result: { failure } }: TestExecution): string {
  return [
    failure?.step === undefined ? undefined : t("defects.report.atStep", { number: failure.step.number, title: failure.step.title }),
    failure?.message === undefined ? undefined : t("defects.report.error", { message: failure.message }),
    failure?.expected === undefined ? undefined : t("defects.report.expected", { expected: failure.expected }),
    failure?.received === undefined ? undefined : t("defects.report.received", { received: failure.received }),
    t("defects.report.execution", { id, date: dateText(ranAt) }),
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

/**
 * The panel that reports a defect of a test that failed: its title and its description, written for the person from the
 * failure and theirs to change, how serious it is, and the execution it comes from. The instance keeps it, and the
 * defects list it.
 *
 * @param props - The test and the execution it failed in, the link that closes the panel, what submits the form, and where the reporting stands.
 * @returns The panel.
 */
export function DefectReportPanel({
  title,
  latest,
  close,
  onSubmit,
  reporting,
}: {
  readonly title: string;
  readonly latest: TestExecution;
  readonly close: string;
  readonly onSubmit?: FormEventHandler<HTMLFormElement>;
  readonly reporting: DefectReporting;
}): ReactNode {
  const step = latest.result.failure?.step;
  const footer = (
    <>
      <a className="btn ghost" href={close}>
        {t("defects.report.cancel")}
      </a>
      <button type="submit" form={FORM} className="btn primary" disabled={reporting.pending || onSubmit === undefined}>
        {t("defects.report.confirm")}
      </button>
    </>
  );
  return (
    <SidePanel id="defect-report-title" title={t("defects.report.title")} close={close} footer={footer}>
      <form id={FORM} className="defect-report" onSubmit={onSubmit}>
        <p className="small muted">{t("defects.report.of", { title })}</p>
        <input type="hidden" name="execution" value={latest.id} />
        <div className="config-field">
          <label htmlFor="defect-title">{t("defects.report.titleField")}</label>
          <input
            id="defect-title"
            name="title"
            type="text"
            required
            maxLength={MAX_DEFECT_TITLE}
            defaultValue={step === undefined ? t("defects.report.fails", { title }) : t("defects.report.failsAt", { title, step: step.number })}
          />
        </div>
        <div className="config-field">
          <label htmlFor="defect-severity">{t("defects.report.severity")}</label>
          <select id="defect-severity" name="severity" defaultValue="S2" aria-describedby="defect-severity-hint">
            {DEFECT_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {t(`defects.severities.${severity}`)}
              </option>
            ))}
          </select>
          <span id="defect-severity-hint" className="field-hint">
            {t("defects.report.severityHint")}
          </span>
        </div>
        <div className="config-field">
          <label htmlFor="defect-description">{t("defects.report.description")}</label>
          <textarea id="defect-description" name="description" rows={8} maxLength={MAX_DEFECT_DESCRIPTION} defaultValue={failureDescription(latest)} />
        </div>
        {reporting.refusal !== undefined && (
          <p className="defects-unread small" role="alert">
            {reporting.refusal}
          </p>
        )}
        <p className="small muted">{t("defects.report.kept")}</p>
      </form>
    </SidePanel>
  );
}
