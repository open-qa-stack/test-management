import type { FormEventHandler, ReactNode } from "react";
import { MAX_CORRECTION, type TestProposal } from "@open-qa-stack/domain/sessions";
import type { Words } from "../i18n/i18n.ts";
import { t } from "../i18n/i18n.ts";
import { SidePanel } from "../ui/side-panel.tsx";

/** The identifier of the form of the panel, which its foot submits. */
const FORM = "review-correct";

/** The identifier of the field of the instruction, which a starter writes in. */
const FIELD = "review-instruction";

/** The starters of an instruction: what each begins, which the person completes. */
const STARTERS: readonly (keyof Words["review"]["correct"]["starters"])[] = ["oracle", "edge", "rename"];

/**
 * Writes the start of an instruction where the cursor stands in its field, and leaves the cursor after it.
 *
 * @param text - What the starter begins.
 */
function start(text: string): void {
  const field = document.getElementById(FIELD) as HTMLTextAreaElement;
  field.setRangeText(text, field.selectionStart, field.selectionEnd, "end");
  field.focus();
}

/**
 * The panel that asks for the correction of a test: what to change, in the words of the person, which starters begin.
 * The session that wrote the test is resumed with it: its agents repair the test, run it again, and it comes back here.
 *
 * @param props - The test, the link that closes the panel, what submits the form, and whether a request is under way.
 * @returns The panel.
 */
export function ReviewCorrect({
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
        {t("review.correct.cancel")}
      </a>
      <button type="submit" form={FORM} className="btn primary" disabled={pending || onSubmit === undefined}>
        {t(pending ? "review.correct.sending" : "review.correct.confirm")}
      </button>
    </>
  );
  return (
    <SidePanel id="review-correct-title" title={t("review.correct.title", { title: proposal.title })} close={close} footer={footer}>
      <form id={FORM} className="review-set-aside" onSubmit={onSubmit}>
        <p>{t("review.correct.intro")}</p>
        <div className="config-field">
          <label htmlFor={FIELD}>{t("review.correct.instruction")}</label>
          <textarea id={FIELD} name="instruction" maxLength={MAX_CORRECTION} rows={5} required aria-describedby="review-instruction-hint" />
          <span id="review-instruction-hint" className="field-hint">
            {t("review.correct.example")}
          </span>
        </div>
        <div className="review-starters">
          {STARTERS.map((starter) => (
            <button key={starter} type="button" className="chip" onClick={() => start(t(`review.correct.startsWith.${starter}`))}>
              {t(`review.correct.starters.${starter}`)}
            </button>
          ))}
        </div>
        <p className="small muted">{t("review.correct.guardrails")}</p>
      </form>
    </SidePanel>
  );
}
