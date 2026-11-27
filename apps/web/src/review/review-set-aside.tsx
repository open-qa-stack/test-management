import type { FormEventHandler, ReactNode } from "react";
import { MAX_SET_ASIDE_NOTE, SET_ASIDE_REASONS, type TestProposal } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { SidePanel } from "../ui/side-panel.tsx";

/** The identifier of the form of the panel, which its foot submits. */
const FORM = "review-set-aside";

/**
 * The panel that sets a test aside: why — already covered, out of scope, a wrong oracle, not at the right level —, the
 * test that covers it for the first, and what the person adds. The test stays to read among those set aside.
 *
 * @param props - The test, the link that closes the panel, what submits the form, and whether a decision is under way.
 * @returns The panel.
 */
export function ReviewSetAside({
  proposal,
  close,
  onSubmit,
  pending,
}: {
  readonly proposal: TestProposal;
  readonly close: string;
  readonly onSubmit?: FormEventHandler<HTMLFormElement>;
  readonly pending: boolean;
}): ReactNode {
  const footer = (
    <>
      <a className="btn ghost" href={close}>
        {t("review.setAside.cancel")}
      </a>
      <button type="submit" form={FORM} className="btn primary" disabled={pending || onSubmit === undefined}>
        {t("review.setAside.confirm")}
      </button>
    </>
  );
  return (
    <SidePanel id="review-set-aside-title" title={t("review.setAside.title", { title: proposal.title })} close={close} footer={footer}>
      <form id={FORM} className="review-set-aside" onSubmit={onSubmit}>
        <fieldset className="config-group">
          <legend>{t("review.setAside.reason")}</legend>
          {SET_ASIDE_REASONS.map((reason) => (
            <label key={reason} className="check">
              <input type="radio" name="reason" value={reason} required />
              <span>{t(`review.setAside.reasons.${reason}`)}</span>
            </label>
          ))}
        </fieldset>
        <div className="config-field">
          <label htmlFor="review-covered-by">{t("review.setAside.coveredBy")}</label>
          <input id="review-covered-by" name="coveredBy" type="text" className="mono" aria-describedby="review-covered-by-hint" />
          <span id="review-covered-by-hint" className="field-hint">
            {t("review.setAside.coveredByHint")}
          </span>
        </div>
        <div className="config-field">
          <label htmlFor="review-note">{t("review.setAside.note")}</label>
          <textarea id="review-note" name="note" maxLength={MAX_SET_ASIDE_NOTE} rows={3} />
        </div>
        <p className="small muted">{t("review.setAside.kept")}</p>
      </form>
    </SidePanel>
  );
}
