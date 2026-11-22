import type { ReactNode } from "react";
import type { Remark, ReviewStep, Speaker, VerdictStep } from "@open-qa-stack/domain/sessions";
import { Badge, type BadgeTone } from "../ui/badge.tsx";
import { Trans } from "react-i18next/TransWithoutContext";
import { i18n, t } from "../i18n/i18n.ts";
import { identityOf } from "./agents.ts";
import { harnessText } from "./harness-words.ts";
import { LongText } from "./long-text.tsx";
import { SpeakerMark } from "./speaker-mark.tsx";

/** What a card of a verdict needs: who gave it and what it came to, what it is about, what it says, and the details it was told with. */
interface VerdictCardProps {
  /** The harness, or the agent that reviewed. */
  readonly author: Speaker;
  /** Whether the author is at work on it. */
  readonly active: boolean;
  /** What the verdict came to, in a few words, and its colour. */
  readonly verdict: readonly [BadgeTone, string];
  /** The state the card is drawn in: refused, accepted, or a review. */
  readonly state: "refused" | "accepted" | "review";
  /** The code of the gate that refused, when one did. */
  readonly code?: string | undefined;
  /** What the verdict is about: the phase, the scenario, the tool. */
  readonly about: readonly string[];
  readonly at: string;
  /** What the verdict says. */
  readonly children: ReactNode;
  /** What it was told with, folded under “Technical details”. */
  readonly details: ReactNode;
}

/** How each author of a verdict is said to judge: the harness by a check that gives the same answer every time, an agent by reading. */
function judgeOf(author: Speaker): readonly [BadgeTone, string] {
  return author === "harness" ? ["outline", t("verdict.automatic")] : ["ai", t("verdict.reviewer")];
}

/**
 * A verdict, whoever gave it, in one form: its author — the harness, a deterministic check, or an agent that
 * reviews — named first, with the kind of judge it is; what it came to; what it is about; what it says; and what it
 * was told with, folded.
 */
function VerdictCard({ author, active, verdict, state, code, about, at, children, details }: VerdictCardProps): ReactNode {
  const [judgeTone, judge] = judgeOf(author);
  return (
    <article className={`verdict ${state}`}>
      <header className="verdict-head">
        <div className="lead">
          <SpeakerMark speaker={author} size="sm" active={active} />
          <b>{identityOf(author).name}</b>
          <Badge tone={judgeTone}>{judge}</Badge>
          <Badge tone={verdict[0]}>{verdict[1]}</Badge>
          {code !== undefined && <span className="verdict-code">{code}</span>}
        </div>
        <span className="turn-at">{at}</span>
      </header>
      <p className="verdict-about">{about.join(" · ")}</p>
      {children}
      <details className="raw">
        <summary>{t("thread.technical")}</summary>
        {details}
      </details>
    </article>
  );
}

/** What a verdict of the harness is about: its phase, the scenario and the tool it names. */
function aboutOf(step: VerdictStep): string[] {
  return [
    step.about,
    ...(step.scenario === undefined ? [] : [t("verdict.scenario", { id: step.scenario })]),
    ...(step.tool === undefined ? [] : [t("verdict.tool", { name: step.tool })]),
  ];
}

/** What a verdict of the harness needs. */
export interface HarnessVerdictProps {
  readonly step: VerdictStep;
  /** Its rank in the thread, which names its text. */
  readonly index: number;
  /** Whether the person unfolded its reason. */
  readonly open: boolean;
  /** Unfolds its reason, or folds it again. */
  readonly onUnfold: () => void;
}

/**
 * A verdict of the harness: accepted on evidence, or refused with the gate that refused, the scenario and the tool
 * it is about, what was refused in the words of the console, then why and what to do, in full; the page it quotes
 * folded under its address, and its text as the harness wrote it under “Technical details”. The error a tool
 * answered, which no gate refused with, is said in a sentence: its raw text is read under the technical details.
 *
 * @param props - The step, its rank, and whether its reason is unfolded.
 * @returns The card.
 */
export function HarnessVerdict({ step, index, open, onUnfold }: HarnessVerdictProps): ReactNode {
  const verdict: readonly [BadgeTone, string] = step.accepted
    ? ["ok", t("verdict.accepted")]
    : ["ko", t(step.code === undefined ? "verdict.error" : "verdict.refused")];
  const raw = step.tool !== undefined && step.code === undefined;
  return (
    <VerdictCard
      author="harness"
      active={false}
      verdict={verdict}
      state={step.accepted ? "accepted" : "refused"}
      code={step.code}
      about={aboutOf(step)}
      at={step.at}
      details={<pre>{step.text}</pre>}
    >
      {raw ? (
        <p className="verdict-subject">{t("thread.toolFailed")}</p>
      ) : (
        <>
          {step.subject !== undefined && <p className="verdict-subject">{harnessText(step.subject)}</p>}
          <LongText id={`verdict-text-${index}`} className="verdict-text" text={step.reason} open={open} onUnfold={onUnfold} />
        </>
      )}
      {step.page !== undefined && (
        <details className="raw">
          <summary>
            {t("verdict.page")} <span className="mono">{step.page.name}</span>
          </summary>
          <pre>{step.page.lines.join("\n")}</pre>
        </details>
      )}
    </VerdictCard>
  );
}

/** What a reviewer reviewed. */
function reviewedOf(step: ReviewStep): string {
  return step.scenario === undefined ? t("verdict.planReview") : t("verdict.testReview", { scenario: step.scenario });
}

/** The verdict of a reviewer in a few words, and its colour: none found is a pass; a call the harness refused or has not answered yet is no verdict. */
function reviewVerdictOf(step: ReviewStep, running: boolean): readonly [BadgeTone, string] {
  if (step.refused === true) return ["ko", t("verdict.notKept")];
  if (running) return ["neutral", t("verdict.running")];
  const count = step.remarks.length;
  if (step.from === "plan_reviewer") return count === 0 ? ["ok", t("verdict.noDuplicate")] : ["warn", t("count.duplicates", { count })];
  return count === 0 ? ["ok", t("verdict.noRemark")] : ["warn", t("count.remarks", { count })];
}

/** A remark of a reviewer, in full: the scenario a duplicate is and what it repeats, where it is and by which rule, then what it says. */
function RemarkView({ remark }: { readonly remark: Remark }): ReactNode {
  const placed = remark.duplicate !== undefined || remark.where !== undefined || remark.rule !== undefined || remark.concerns === "plan";
  return (
    <li className="remark">
      {placed && (
        <div className="remark-head">
          {remark.duplicate !== undefined && (
            <span>
              <Trans
                i18n={i18n}
                i18nKey="verdict.duplicates"
                values={{ scenario: remark.duplicate.scenario, of: remark.duplicate.of }}
                components={{ b: <b />, code: <span className="mono" /> }}
              />
            </span>
          )}
          {remark.where !== undefined && <b>{remark.where}</b>}
          {remark.rule !== undefined && <span className="verdict-code">{remark.rule}</span>}
          {remark.concerns === "plan" && <Badge tone="neutral">{t("verdict.aboutPlan")}</Badge>}
        </div>
      )}
      <p className="remark-text">{remark.text}</p>
    </li>
  );
}

/**
 * The verdict of a reviewer, in the form of every verdict: who reviewed what, what it came to, and each of its
 * remarks in full — one in sight, several folded under their count. The call it was handed in with — the tool,
 * what the harness answered, the word the reviewer replied — is under “Technical details”, for whoever looks into
 * the working of the review.
 *
 * @param props - The step, and whether the reviewer is handing it in.
 * @returns The card.
 */
export function ReviewVerdict({ step, running }: { readonly step: ReviewStep; readonly running: boolean }): ReactNode {
  const verdict = reviewVerdictOf(step, running);
  const remarks = (
    <ol className="remarks">
      {step.remarks.map((remark, index) => (
        <RemarkView key={index} remark={remark} />
      ))}
    </ol>
  );
  return (
    <VerdictCard
      author={step.from}
      active={running}
      verdict={verdict}
      state="review"
      about={[reviewedOf(step), identityOf(step.from).role]}
      at={step.at}
      details={
        <dl>
          <dt>{t("verdict.toolLabel")}</dt>
          <dd className="mono">{step.tool}</dd>
          {step.answer !== undefined && (
            <>
              <dt>{t("verdict.harnessAnswer")}</dt>
              <dd>{step.answer}</dd>
            </>
          )}
          {step.reply !== undefined && (
            <>
              <dt>{t("verdict.reviewerAnswer")}</dt>
              <dd>{step.reply}</dd>
            </>
          )}
        </dl>
      }
    >
      {step.remarks.length === 1 && remarks}
      {step.remarks.length > 1 && (
        <details className="raw remarks-fold">
          <summary>{verdict[1]}</summary>
          {remarks}
        </details>
      )}
    </VerdictCard>
  );
}
