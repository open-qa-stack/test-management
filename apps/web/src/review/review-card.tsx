import type { ReactNode } from "react";
import type { TestProposal } from "@open-qa-stack/domain/sessions";
import { applicationName } from "../applications/application-names.ts";
import { t } from "../i18n/i18n.ts";
import { levelName } from "../i18n/vocabulary.ts";
import { Badge } from "../ui/badge.tsx";
import { Code } from "../ui/code.tsx";

/** What a person does of the test on the card: validate it, or open the panel that sets it aside, while no decision is under way. */
export interface ReviewGestures {
  readonly validate: () => void;
  /** The link to the panel that sets it aside. */
  readonly setAside: string;
  /** Whether a decision is under way, which leaves the gestures inactive. */
  readonly pending: boolean;
  /** Why the instance refused the last decision, when it did. */
  readonly refusal?: string;
}

/** The gestures of a test to review: set aside, ask for a correction — which stays inactive —, and validate. */
function Gestures({ gestures }: { readonly gestures: ReviewGestures | undefined }): ReactNode {
  const idle = gestures !== undefined && !gestures.pending;
  return (
    <>
      {gestures?.refusal !== undefined && (
        <p className="review-refusal small" role="alert">
          {gestures.refusal}
        </p>
      )}
      <div className="review-actions">
        {idle ? (
          <a className="btn ghost" href={gestures.setAside}>
            {t("review.gestures.setAside")}
          </a>
        ) : (
          <button type="button" className="btn ghost" disabled>
            {t("review.gestures.setAside")}
          </button>
        )}
        <button type="button" className="btn" disabled aria-keyshortcuts="C">
          {t("review.gestures.correct")}
        </button>
        <button type="button" className="btn primary" disabled={!idle} aria-keyshortcuts="V" onClick={gestures?.validate}>
          {t(gestures?.pending === true ? "review.gestures.validating" : "review.gestures.validate")}
        </button>
      </div>
    </>
  );
}

/**
 * The card of a test the agents wrote, which a person reads to decide of it: what it is, why it was written and what it
 * verifies first, then what the agents that reviewed it said, and its code, folded, last; then, for a test to review, the
 * gestures, inactive without what makes them.
 *
 * @param props - The test, and what the gestures do.
 * @returns The card.
 */
export function ReviewCard({ proposal, gestures }: { readonly proposal: TestProposal; readonly gestures?: ReviewGestures }): ReactNode {
  const { decision } = proposal;
  return (
    <article className="card review-card" aria-labelledby="review-title">
      <header className="review-card-head">
        <div className="row review-badges">
          <Badge tone={proposal.status === "set_aside" ? "neutral" : "warn"}>{t(`review.status.${proposal.status}`)}</Badge>
          <Badge tone="outline">{levelName(proposal.level)}</Badge>
          {proposal.kind === "visual" && <Badge tone="outline">{t("review.visual")}</Badge>}
          <Badge tone={proposal.reviewed ? "ok" : "neutral"}>{t(proposal.reviewed ? "review.reviewed" : "review.notReviewed")}</Badge>
          <Badge tone={proposal.verdict === "passed" ? "ok" : "ko"}>{t(`review.verdicts.${proposal.verdict === "passed" ? "passed" : "failed"}`)}</Badge>
        </div>
        <h2 id="review-title">{proposal.title}</h2>
        <p className="small muted">
          {t("review.where", { application: applicationName(proposal.application), domain: proposal.domain, feature: proposal.feature })}
        </p>
      </header>
      {decision?.status === "set_aside" && (
        <p className="review-decision" role="note">
          {t(`review.reasons.${decision.reason}`)}
          {decision.coveredBy === undefined ? "" : ` — ${decision.coveredBy}`}
          {decision.note === undefined ? "" : ` · ${decision.note}`}
        </p>
      )}
      <section className="review-section" aria-labelledby="review-why">
        <h3 id="review-why">
          {t("review.why")} <Badge tone="ai">{t("review.byAgents")}</Badge>
        </h3>
        <p>{proposal.intent}</p>
        {proposal.brief !== undefined && <p className="small muted">{t("review.brief", { brief: proposal.brief })}</p>}
        <p className="small muted">
          {t("review.sources")} {proposal.sources.map(({ source, item }) => (item === undefined ? source : `${source} — ${item}`)).join(", ")}
        </p>
      </section>
      <section className="review-section" aria-labelledby="review-verifies">
        <h3 id="review-verifies">{t("review.verifies")}</h3>
        <ol className="review-steps">
          {proposal.steps.map(({ action, expects }) => (
            <li key={action}>
              {action}
              {expects.length > 0 && (
                <ul className="small muted">
                  {expects.map((expected) => (
                    <li key={expected}>{expected}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </section>
      <section className="review-section" aria-labelledby="review-remarks">
        <h3 id="review-remarks">{t("review.remarks")}</h3>
        {proposal.remarks.length === 0 ? (
          <p className="small muted">{t(proposal.reviewed ? "review.noRemark" : "review.notReviewedNote")}</p>
        ) : (
          <ul className="review-remark-list">
            {proposal.remarks.map(({ about, where, what, rule }) => (
              <li key={`${about} ${where} ${what}`}>
                <b>{t(`review.about.${about}`, { where })}</b> {what}
                {rule !== undefined && <span className="small muted mono"> {rule}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <details className="review-section review-code">
        <summary>{t("review.code", { files: proposal.files.map(({ path, added }) => `${path} (+${added})`).join(" · ") })}</summary>
        {proposal.files.map(({ path, content }) => (
          <div key={path} className="review-file">
            <p className="small mono">{path}</p>
            <Code lines={content.trimEnd().split("\n")} className="review-code-lines" />
          </div>
        ))}
      </details>
      <footer className="review-card-foot">
        <p className="small muted">
          {t("review.runs", { count: proposal.runs })} · {proposal.reason}
        </p>
        {proposal.status === "in_review" && <Gestures gestures={gestures} />}
      </footer>
    </article>
  );
}
