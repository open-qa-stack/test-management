import type { ReactNode } from "react";
import type { Remark, ReviewStep, Speaker, VerdictStep } from "@open-qa-stack/domain/sessions";
import { Badge, type BadgeTone } from "../ui/badge.tsx";
import { counted } from "../ui/counted.ts";
import { IDENTITIES } from "./agents.ts";
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
  /** What it was told with, folded under « Détails ». */
  readonly details: ReactNode;
}

/** How each author of a verdict is said to judge: the harness by a check that gives the same answer every time, an agent by reading. */
function judgeOf(author: Speaker): readonly [BadgeTone, string] {
  return author === "harness" ? ["outline", "contrôle automatique"] : ["ai", "agent relecteur"];
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
          <b>{IDENTITIES[author].name}</b>
          <Badge tone={judgeTone}>{judge}</Badge>
          <Badge tone={verdict[0]}>{verdict[1]}</Badge>
          {code !== undefined && <span className="verdict-code">{code}</span>}
        </div>
        <span className="turn-at">{at}</span>
      </header>
      <p className="verdict-about">{about.join(" · ")}</p>
      {children}
      <details className="raw">
        <summary>Détails</summary>
        {details}
      </details>
    </article>
  );
}

/** What a verdict of the harness is about: its phase, the scenario and the tool it names. */
function aboutOf(step: VerdictStep): string[] {
  return [step.about, ...(step.scenario === undefined ? [] : [`scénario ${step.scenario}`]), ...(step.tool === undefined ? [] : [`outil ${step.tool}`])];
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
 * it is about, what was refused, then why and what to do, in full; the page it quotes folded under its address, and
 * its text as the harness wrote it under « Détails ».
 *
 * @param props - The step, its rank, and whether its reason is unfolded.
 * @returns The card.
 */
export function HarnessVerdict({ step, index, open, onUnfold }: HarnessVerdictProps): ReactNode {
  const verdict: readonly [BadgeTone, string] = step.accepted ? ["ok", "accepté"] : ["ko", step.code === undefined ? "erreur" : "refusé"];
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
      {step.subject !== undefined && <p className="verdict-subject">{step.subject}</p>}
      <LongText id={`verdict-text-${index}`} className="verdict-text" text={step.reason} open={open} onUnfold={onUnfold} />
      {step.page !== undefined && (
        <details className="raw">
          <summary>
            Page à ce moment <span className="mono">{step.page.name}</span>
          </summary>
          <pre>{step.page.lines.join("\n")}</pre>
        </details>
      )}
    </VerdictCard>
  );
}

/** What a reviewer reviewed. */
function reviewedOf(step: ReviewStep): string {
  return step.scenario === undefined ? "relecture du plan" : `relecture du test de ${step.scenario}`;
}

/** The verdict of a reviewer in a few words, and its colour: none found is a pass; a call the harness refused or has not answered yet is no verdict. */
function reviewVerdictOf(step: ReviewStep, running: boolean): readonly [BadgeTone, string] {
  if (step.refused === true) return ["ko", "non retenu par le harnais"];
  if (running) return ["neutral", "en cours"];
  const count = step.remarks.length;
  if (step.from === "plan_reviewer") return count === 0 ? ["ok", "aucun doublon"] : ["warn", counted(count, "doublon", "doublons")];
  return count === 0 ? ["ok", "aucune remarque"] : ["warn", counted(count, "remarque", "remarques")];
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
              <b>{remark.duplicate.scenario}</b> double <span className="mono">{remark.duplicate.of}</span>
            </span>
          )}
          {remark.where !== undefined && <b>{remark.where}</b>}
          {remark.rule !== undefined && <span className="verdict-code">{remark.rule}</span>}
          {remark.concerns === "plan" && <Badge tone="neutral">porte sur le plan</Badge>}
        </div>
      )}
      <p className="remark-text">{remark.text}</p>
    </li>
  );
}

/**
 * The verdict of a reviewer, in the form of every verdict: who reviewed what, what it came to, and each of its
 * remarks in full. The call it was handed in with — the tool, what the harness answered, the word the reviewer
 * replied — is under « Détails », for whoever looks into the working of the review.
 *
 * @param props - The step, and whether the reviewer is handing it in.
 * @returns The card.
 */
export function ReviewVerdict({ step, running }: { readonly step: ReviewStep; readonly running: boolean }): ReactNode {
  return (
    <VerdictCard
      author={step.from}
      active={running}
      verdict={reviewVerdictOf(step, running)}
      state="review"
      about={[reviewedOf(step), IDENTITIES[step.from].role]}
      at={step.at}
      details={
        <dl>
          <dt>Outil</dt>
          <dd className="mono">{step.tool}</dd>
          {step.answer !== undefined && (
            <>
              <dt>Réponse du harnais</dt>
              <dd>{step.answer}</dd>
            </>
          )}
          {step.reply !== undefined && (
            <>
              <dt>Réponse du relecteur</dt>
              <dd>{step.reply}</dd>
            </>
          )}
        </dl>
      }
    >
      {step.remarks.length > 0 && (
        <ol className="remarks">
          {step.remarks.map((remark, index) => (
            <RemarkView key={index} remark={remark} />
          ))}
        </ol>
      )}
    </VerdictCard>
  );
}
