import type { ReactNode } from "react";
import type { TestProposal } from "@open-qa-stack/domain/sessions";
import { applicationName } from "../applications/application-names.ts";
import { t } from "../i18n/i18n.ts";
import { levelName } from "../i18n/vocabulary.ts";
import { Badge } from "../ui/badge.tsx";
import { Code } from "../ui/code.tsx";
import { hrefTo } from "../routing/route.ts";

/** What a person does of the test on the card: validate it, open the panel that sets it aside or the one that asks for its correction, or put it back in review once set aside, while no decision is under way. */
export interface ReviewGestures {
  readonly validate: () => void;
  readonly restore: () => void;
  /** The link to the panel that sets it aside. */
  readonly setAside: string;
  /** The link to the panel that asks for its correction. */
  readonly correct: string;
  /** Whether a decision is under way, which leaves the gestures inactive. */
  readonly pending: boolean;
  /** Why the instance refused the last decision, when it did. */
  readonly refusal?: string;
}

/** Why the instance refused the last decision, when it did. */
function Refusal({ gestures }: { readonly gestures: ReviewGestures | undefined }): ReactNode {
  return (
    gestures?.refusal !== undefined && (
      <p className="review-refusal small" role="alert">
        {gestures.refusal}
      </p>
    )
  );
}

/** The gesture of a test set aside: put it back in review, as it was. */
function Restore({ gestures }: { readonly gestures: ReviewGestures | undefined }): ReactNode {
  const idle = gestures !== undefined && !gestures.pending;
  return (
    <>
      <Refusal gestures={gestures} />
      <div className="review-actions">
        <button type="button" className="btn" disabled={!idle} onClick={gestures?.restore}>
          {t(gestures?.pending === true ? "review.gestures.restoring" : "review.gestures.restore")}
        </button>
      </div>
    </>
  );
}

/** The gestures of a test to review: set aside, ask for a correction, and validate. */
function Gestures({ gestures }: { readonly gestures: ReviewGestures | undefined }): ReactNode {
  const idle = gestures !== undefined && !gestures.pending;
  return (
    <>
      <Refusal gestures={gestures} />
      <div className="review-actions">
        {idle ? (
          <a className="btn ghost" href={gestures.setAside} aria-keyshortcuts="E">
            {t("review.gestures.setAside")} <kbd>E</kbd>
          </a>
        ) : (
          <button type="button" className="btn ghost" disabled aria-keyshortcuts="E">
            {t("review.gestures.setAside")} <kbd>E</kbd>
          </button>
        )}
        {idle ? (
          <a className="btn" href={gestures.correct} aria-keyshortcuts="C">
            {t("review.gestures.correct")} <kbd>C</kbd>
          </a>
        ) : (
          <button type="button" className="btn" disabled aria-keyshortcuts="C">
            {t("review.gestures.correct")} <kbd>C</kbd>
          </button>
        )}
        <button type="button" className="btn primary" disabled={!idle} aria-keyshortcuts="V" onClick={gestures?.validate}>
          {t(gestures?.pending === true ? "review.gestures.validating" : "review.gestures.validate")} <kbd>V</kbd>
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
        <div className="review-badges">
          <Badge tone="ai">{t("review.byAgent")}</Badge>
          {proposal.status !== "in_review" && (
            <Badge tone={proposal.status === "set_aside" ? "neutral" : "info"}>{t(`review.status.${proposal.status}`)}</Badge>
          )}
          {proposal.kind === "visual" && <Badge tone="outline">{t("review.visual")}</Badge>}
          <Badge tone={proposal.verdict === "passed" ? "ok" : "ko"}>{t(`review.verdicts.${proposal.verdict === "passed" ? "passed" : "failed"}`)}</Badge>
          <Badge tone={proposal.reviewed ? "ok" : "neutral"}>{t(proposal.reviewed ? "review.reviewed" : "review.notReviewed")}</Badge>
        </div>
        <h2 id="review-title">{proposal.title}</h2>
        <dl className="test-facts">
          <div>
            <dt>{t("review.facts.level")}</dt>
            <dd>{levelName(proposal.level)}</dd>
          </div>
          <div>
            <dt>{t("review.facts.feature")}</dt>
            <dd className="mono">
              {proposal.domain} › {proposal.feature}
            </dd>
          </div>
          <div>
            <dt>{t("review.facts.application")}</dt>
            <dd>{applicationName(proposal.application)}</dd>
          </div>
        </dl>
      </header>
      {decision?.status === "in_correction" && (
        <p className="review-decision" role="note">
          {t("review.correction", { instruction: decision.instruction })}{" "}
          <a href={hrefTo(`/agent/sessions/${decision.session}`)}>
            {t(proposal.status === "in_correction" ? "review.followCorrection" : "review.readCorrection")}
          </a>
        </p>
      )}
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
          {proposal.steps.map(({ action, expects }, rank) => (
            <li key={action}>
              <span className="review-step-number" aria-hidden="true">
                {rank + 1}
              </span>
              <span className="review-step-text">
                {action}
                {expects.length > 0 && (
                  <ul className="small muted">
                    {expects.map((expected) => (
                      <li key={expected}>{expected}</li>
                    ))}
                  </ul>
                )}
              </span>
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
      <section className="review-section" aria-labelledby="review-added">
        <h3 id="review-added">{t("review.added")}</h3>
        <div className="review-files">
          {proposal.files.map(({ path, content, added }) => (
            <details key={path} className="review-file">
              <summary>
                <span className="mono grow">{path}</span>
                <span className="review-file-added">+{added}</span>
              </summary>
              <Code lines={content.trimEnd().split("\n")} className="review-code-lines" />
            </details>
          ))}
        </div>
      </section>
      <footer className="review-card-foot">
        <p className="small muted">
          {t("review.runs", { count: proposal.runs })} · {proposal.reason}
        </p>
        {proposal.status === "in_review" && <Gestures gestures={gestures} />}
        {proposal.status === "set_aside" && <Restore gestures={gestures} />}
      </footer>
    </article>
  );
}
