import type { ReactNode } from "react";
import { hrefTo } from "../routing/route.ts";
import { Badge, type BadgeTone } from "../ui/badge.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Icon } from "../ui/icon.tsx";
import { IDENTITIES } from "./agents.ts";
import { eyeIdOf } from "./opened-look.ts";
import { shows, type Frame, type ShownStep, type ThreadFilter } from "./playback.ts";
import { elapsedText } from "./session-facts.ts";
import {
  turnsOf,
  type NoteStep,
  type OutcomeStep,
  type PassStep,
  type Remark,
  type RepeatedNoteStep,
  type ReviewStep,
  type SayStep,
  type SessionStage,
  type Speaker,
  type ToolStep,
  type Turn,
  type VerdictStep,
} from "@open-qa-stack/domain/sessions";
import { PlanCard } from "./plan-card.tsx";
import { SpeakerMark } from "./speaker-mark.tsx";
import { iconOf } from "./tool-icon.ts";
import { counted } from "../ui/counted.ts";

/** What the thread of a session needs. */
export interface ThreadProps {
  /** The path of the session, which the links of the thread come back to. */
  readonly path: string;
  /** The session at this moment. */
  readonly frame: Frame;
  /** The rank of the action whose look is open, if any. */
  readonly lookIndex: number | undefined;
  /** What the thread keeps of the session; everything by default. */
  readonly filter?: ThreadFilter;
  /** The only speaker the thread follows, if any. */
  readonly followed?: Speaker;
  /** The parameters of the address the links of the thread keep, such as its filter. */
  readonly query?: Readonly<Record<string, string>>;
  /** Where the session is: an empty thread says what it waits for, or that nothing will come. */
  readonly stage: SessionStage;
  /** The ranks of the long texts the person unfolded. */
  readonly unfolded: readonly number[];
  /** Unfolds a long text, by the rank of its step, or folds it again. */
  readonly onUnfold: (index: number) => void;
}

/** What the links of a thread need to come back to it. */
interface Back {
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly lookIndex: number | undefined;
  /** The only speaker the thread follows, if any. */
  readonly followed: Speaker | undefined;
  readonly unfolded: readonly number[];
  readonly onUnfold: (index: number) => void;
}

/** How many lines a long text shows before it is unfolded. */
const FOLDED_LINES = 6;

/** How many characters a text holds at most to be shown whole at once: about the room of its folded lines. */
const FOLDED_LENGTH = 480;

/** What an empty thread says, by where its session is: its title, then what comes next. */
const EMPTY: Readonly<Record<SessionStage, readonly [string, string]>> = {
  queued: ["La session attend d’être prise par un agent", "Le fil se remplira dès qu’elle démarrera ; un message envoyé d’ici là sera remis à ses agents."],
  live: ["Les agents n’ont encore rien écrit", "Le fil se remplira dès leur premier événement."],
  ended: ["Cette session n’a laissé aucun événement", "Elle s’est arrêtée avant que ses agents ne commencent."],
};

/** How each verdict of a test reads, and its colour family; any other reads as it is. */
const VERDICTS: Readonly<Record<string, readonly ["ok" | "ko" | "warn", string]>> = {
  passed: ["ok", "réussi"],
  failed: ["ko", "échoué"],
  blocked: ["warn", "bloqué"],
};

/** A reasoning of an agent: folded to its first line once written, open while it is being written. */
function Thinking({ step, shown }: { readonly step: SayStep; readonly shown: ShownStep }): ReactNode {
  return (
    <details className="thinking" open={shown.running}>
      <summary>
        <Icon name="thought" />
        <span className="thinking-label">Réflexion</span>
        <span className="thinking-preview" aria-hidden="true">
          {step.text}
        </span>
      </summary>
      <p className="thinking-text">
        {shown.written}
        {shown.running && <span className="caret" />}
      </p>
    </details>
  );
}

/** How an action ended, as a mark before its sentence. */
function ActionState({ step, running }: { readonly step: ToolStep; readonly running: boolean }): ReactNode {
  if (running) return <span className="spinner" role="img" aria-label="en cours" />;
  if (step.outcome === "failed") return <span className="act-state ko" role="img" aria-label="échec" />;
  if (step.outcome === "passed") return <span className="act-state ok" role="img" aria-label="réussi" />;
  return <span className="act-state" aria-hidden="true" />;
}

/** What a run of a file of tests ran, a test a row: its verdict, then its title. */
function RanTests({ step }: { readonly step: ToolStep }): ReactNode {
  return (
    <ul className="act-tests">
      {step.tests!.map((test, index) => {
        const [tone, label] = VERDICTS[test.verdict] ?? (["warn", test.verdict] as const);
        return (
          <li key={index}>
            <Badge tone={tone}>{label}</Badge>
            <span>{test.title}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * An action of an agent, in a row: what it did and how it ended, on a line what it gave unfolds under; then its
 * eye, which opens what the agent had before its eyes, and the time it took, which ends the row. An action on the
 * file of a test names the test, says how its run ended and where the file is, and can be unfolded and looked
 * into from its start: under it, the verdict of each test the run ran, what the tool answered when the run did
 * not pass, and the code.
 */
function Action({ step, shown, back }: { readonly step: ToolStep; readonly shown: ShownStep; readonly back: Back }): ReactNode {
  const file = step.look?.kind === "file" ? step.look : undefined;
  const ran = !shown.running && step.tests !== undefined && step.outcome !== undefined ? ` : ${VERDICTS[step.outcome]![1]}` : "";
  const title = <span className="act-title">{`${step.title}${ran}`}</span>;
  const line = (
    <>
      <ActionState step={step} running={shown.running} />
      <Icon name={iconOf(step.tool)} />
      {file === undefined ? (
        title
      ) : (
        <span className="act-text">
          {title}
          <span className="act-path">{file.name}</span>
        </span>
      )}
    </>
  );
  const answered = !shown.running && step.detail !== undefined;
  const told = answered && !(step.tests !== undefined && step.outcome === "passed");
  const selected = back.lookIndex === shown.index;
  const look = step.look !== undefined && (!shown.running || file !== undefined) && (
    <a
      id={eyeIdOf(shown.index)}
      className="act-look"
      href={hrefTo(back.path, { ...back.query, look: String(shown.index) })}
      aria-current={selected ? "true" : undefined}
      aria-label={`${step.title} — voir ${step.look.kind === "file" ? "le fichier de test" : "la page consultée"}`}
    >
      <Icon name="eye" />
    </a>
  );
  return (
    <div className={selected ? "act selected" : "act"}>
      {!answered && file === undefined ? (
        <div className="act-line">{line}</div>
      ) : (
        <details>
          <summary className="act-line">{line}</summary>
          {!shown.running && step.tests !== undefined && <RanTests step={step} />}
          {told && <pre className="act-result">{step.detail}</pre>}
          {file !== undefined && <pre className="act-code">{file.lines.join("\n")}</pre>}
        </details>
      )}
      {look}
      {!shown.running && step.durationMs !== undefined && <span className="act-time">{elapsedText(step.durationMs)}</span>}
    </div>
  );
}

/**
 * What one agent thought, said and did in a row, under its name. The name follows the agent: it leaves that
 * agent alone in the thread, or brings the others back when the thread already follows it.
 */
function AgentTurn({ turn, back }: { readonly turn: Extract<Turn<ShownStep>, { kind: "agent" }>; readonly back: Back }): ReactNode {
  const { name, role } = IDENTITIES[turn.agent];
  const active = turn.items.some(({ running }) => running);
  const follows = back.followed === turn.agent;
  const { agent: _followed, ...others } = back.query;
  return (
    <article className="turn">
      <SpeakerMark speaker={turn.agent} active={active} />
      <div className="turn-body">
        <header className="turn-head">
          <a
            className="turn-agent"
            href={hrefTo(back.path, follows ? others : { ...others, agent: turn.agent })}
            aria-label={`${name} : ${follows ? "voir tous les agents" : "ne voir que cet agent"}`}
          >
            {name}
          </a>
          <span className="turn-role">{role}</span>
          <span className="turn-at">{turn.items[0]!.step.at}</span>
        </header>
        {turn.items.map((shown) => {
          const { step } = shown;
          if (step.kind === "tool") return <Action key={shown.index} step={step} shown={shown} back={back} />;
          const said = step as SayStep;
          if (said.thinking === true) return <Thinking key={shown.index} step={said} shown={shown} />;
          return (
            <p key={shown.index} className="turn-text">
              {shown.written}
              {shown.running && <span className="caret" />}
            </p>
          );
        })}
      </div>
    </article>
  );
}

/** What the harness asks of an agent: who it hands the work to, its request folded under it. */
function Brief({ shown }: { readonly shown: ShownStep }): ReactNode {
  const step = shown.step as SayStep;
  return (
    <details className="brief" open={shown.running}>
      <summary>
        <SpeakerMark speaker="harness" size="sm" />
        <span>
          <b>{IDENTITIES.harness.name}</b> passe la main à <b>{IDENTITIES[step.to!].name}</b>
        </span>
        <span className="turn-at">{step.at}</span>
      </summary>
      <p className="brief-text">{shown.written}</p>
    </details>
  );
}

/** What a note says, on its line: its text, or for a row of notes alike what they say around their sources. */
function noteTextOf(step: NoteStep | RepeatedNoteStep): string {
  return step.kind === "note" ? step.text : `${step.before}…${step.after}`;
}

/** A row of notes alike: one line, what they say around the name of a source and how many sources, which unfolds on each note. */
function RepeatedNotes({ step }: { readonly step: RepeatedNoteStep }): ReactNode {
  return (
    <details className="notes">
      <summary>
        <Icon name="shield" />
        <span>{noteTextOf(step)}</span>
        <span className="note-count">{counted(step.sources.length, "source", "sources")}</span>
      </summary>
      <ul>
        {step.notes.map((note, index) => (
          <li key={index}>
            <span className="turn-at">{note.at}</span> {note.text}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The notes of the harness that follow one another: one in a line, a row of notes alike folded under its count of sources, several folded under their count. */
function Notes({ items }: { readonly items: readonly ShownStep[] }): ReactNode {
  const steps = items.map(({ step }) => step as NoteStep | RepeatedNoteStep);
  const [first] = steps;
  if (steps.length === 1 && first!.kind === "repeated") return <RepeatedNotes step={first!} />;
  if (steps.length === 1) {
    return (
      <div className="notes single">
        <Icon name="shield" />
        <span className="note-text">{noteTextOf(first!)}</span>
      </div>
    );
  }
  return (
    <details className="notes">
      <summary>
        <Icon name="shield" />
        <span>{steps.length} notes du harnais</span>
        <span className="note-preview" aria-hidden="true">
          {noteTextOf(steps.at(-1)!)}
        </span>
      </summary>
      <ul>
        {steps.map((step, index) =>
          step.kind === "repeated" ? (
            <li key={index}>
              <RepeatedNotes step={step} />
            </li>
          ) : (
            <li key={index}>
              <span className="turn-at">{step.at}</span> {step.text}
            </li>
          ),
        )}
      </ul>
    </details>
  );
}

/**
 * A text read at length, whole: one that would not hold in a few lines shows its first ones, and a button under
 * it unfolds the rest in place, then folds it again. The end of a refusal says what to do: it is one press away.
 */
function LongText({
  id,
  text,
  className,
  index,
  back,
}: {
  readonly id: string;
  readonly text: string;
  readonly className: string;
  readonly index: number;
  readonly back: Back;
}): ReactNode {
  const long = text.length > FOLDED_LENGTH || text.split("\n").length > FOLDED_LINES;
  const open = back.unfolded.includes(index);
  return (
    <>
      <p id={id} className={long && !open ? `${className} folded` : className}>
        {text}
      </p>
      {long && (
        <button type="button" className="btn ghost sm read-more" aria-expanded={open} aria-controls={id} onClick={() => back.onUnfold(index)}>
          {open ? "Replier" : "Lire la suite"}
        </button>
      )}
    </>
  );
}

/** A verdict of the harness: accepted on evidence, or refused with the gate that refused, and what it says in full. */
function Verdict({ step, index, back }: { readonly step: VerdictStep; readonly index: number; readonly back: Back }): ReactNode {
  return (
    <article className={step.accepted ? "verdict accepted" : "verdict refused"}>
      <header className="verdict-head">
        <div className="lead">
          <SpeakerMark speaker="harness" size="sm" />
          <b>{IDENTITIES.harness.name}</b>
          <Badge tone={step.accepted ? "ok" : "ko"}>{step.accepted ? "accepté" : "refusé"}</Badge>
          {step.code !== undefined && <span className="verdict-code">{step.code}</span>}
          <span className="turn-role">{step.about}</span>
        </div>
        <span className="turn-at">{step.at}</span>
      </header>
      <LongText id={`verdict-text-${index}`} className="verdict-text" text={step.text} index={index} back={back} />
    </article>
  );
}

/** What a reviewer reviewed, as its card says it. */
function reviewedOf(step: ReviewStep): string {
  return step.scenario === undefined ? "a relu le plan" : `a relu le test de ${step.scenario}`;
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
 * The verdict of a reviewer: who reviewed what, what it came to, and each of its remarks in full. The call it
 * was handed in with — the tool, what the harness answered, the word the reviewer replied — is folded under it,
 * for whoever looks into the working of the review.
 */
function Review({ step, running }: { readonly step: ReviewStep; readonly running: boolean }): ReactNode {
  const [tone, verdict] = reviewVerdictOf(step, running);
  return (
    <article className="verdict review">
      <header className="verdict-head">
        <div className="lead">
          <SpeakerMark speaker={step.from} size="sm" active={running} />
          <b>{IDENTITIES[step.from].name}</b>
          <span className="turn-role">{reviewedOf(step)}</span>
          <Badge tone={tone}>{verdict}</Badge>
        </div>
        <span className="turn-at">{step.at}</span>
      </header>
      {step.remarks.length > 0 && (
        <ol className="remarks">
          {step.remarks.map((remark, index) => (
            <RemarkView key={index} remark={remark} />
          ))}
        </ol>
      )}
      {step.answer !== undefined && (
        <details className="review-call">
          <summary>Détails de l’appel</summary>
          <dl>
            <dt>Outil</dt>
            <dd className="mono">{step.tool}</dd>
            <dt>Réponse du harnais</dt>
            <dd>{step.answer}</dd>
            {step.reply !== undefined && (
              <>
                <dt>Réponse du relecteur</dt>
                <dd>{step.reply}</dd>
              </>
            )}
          </dl>
        </details>
      )}
    </article>
  );
}

/** The start of a pass: the level of the pyramid the agents now work on. */
function Pass({ step }: { readonly step: PassStep }): ReactNode {
  return (
    <div
      className={step.minor === true ? "pass minor" : "pass"}
      role="separator"
      aria-label={[step.title, step.summary].filter((part) => part !== "").join(" · ")}
    >
      <span className="pass-title">{step.title}</span>
      {step.summary !== "" && <span className="pass-summary">{step.summary}</span>}
    </div>
  );
}

/** What the session produced, with the verdict of each test. */
function Outcome({ step }: { readonly step: OutcomeStep }): ReactNode {
  return (
    <section className="result-card outcome">
      <header>
        <b>{step.title}</b>
      </header>
      {step.tests.map((test, index) => {
        const [tone, label] = VERDICTS[test.verdict] ?? (["warn", test.verdict] as const);
        return (
          <div key={index} className="result-row">
            <Badge tone={tone}>{label}</Badge>
            <span className="result-title">{test.title}</span>
            <span className="turn-role">{test.note ?? test.level}</span>
          </div>
        );
      })}
    </section>
  );
}

/**
 * What the person said to the agents while they worked: a bubble as the request, and under it where the
 * message is — waiting for an agent to take it, or with the agent that did.
 */
function Message({ turn }: { readonly turn: Extract<Turn<ShownStep>, { kind: "message" }> }): ReactNode {
  return (
    <div className="sent">
      <div className="request">
        <span className="sr-only">Votre message : </span>
        {turn.shown.written}
      </div>
      <span className="sent-status">{turn.deliveredTo === undefined ? "en attente d’un agent" : `remis à ${IDENTITIES[turn.deliveredTo].name}`}</span>
    </div>
  );
}

/** One turn of the thread, as its kind shows it. */
function TurnView({ turn, back }: { readonly turn: Turn<ShownStep>; readonly back: Back }): ReactNode {
  if (turn.kind === "request") {
    return (
      <div className="request">
        <span className="sr-only">Votre demande : </span>
        {turn.shown.written}
      </div>
    );
  }
  if (turn.kind === "message") return <Message turn={turn} />;
  if (turn.kind === "agent") return <AgentTurn turn={turn} back={back} />;
  if (turn.kind === "brief") return <Brief shown={turn.shown} />;
  if (turn.kind === "notes") return <Notes items={turn.items} />;
  const { step } = turn.shown;
  if (step.kind === "review") return <Review step={step} running={turn.shown.running} />;
  if (step.kind === "verdict") return <Verdict step={step} index={turn.shown.index} back={back} />;
  if (step.kind === "plan") return <PlanCard step={step} />;
  if (step.kind === "pass") return <Pass step={step} />;
  return <Outcome step={step as OutcomeStep} />;
}

/**
 * The thread of a session, as a conversation: what was asked, what the person said since, each agent in turn — what it thought,
 * folded, what it said, and what it did, a line per action — the verdicts of the harness, the plans, and
 * what the session produced. While its agents work, its last line names who is at work.
 *
 * @param props - The session at this moment.
 * @returns The thread.
 */
export function Thread({ path, frame, lookIndex, filter = "all", followed, query = {}, stage, unfolded, onUnfold }: ThreadProps): ReactNode {
  const turns = turnsOf(frame.shown.filter(({ step }) => shows(step, filter, followed)));
  const back: Back = { path, query, lookIndex, followed, unfolded, onUnfold };
  const working = frame.speaking === undefined || frame.speaking === "user" ? undefined : frame.speaking;
  return (
    <section className="thread" aria-label="Fil de la session">
      {frame.shown.length === 0 && <EmptyState title={EMPTY[stage][0]}>{EMPTY[stage][1]}</EmptyState>}
      {turns.map((turn, index) => (
        <div key={index} className="thread-item">
          <TurnView turn={turn} back={back} />
        </div>
      ))}
      {stage === "live" && frame.shown.length > 0 && (
        <div className="working" role="status">
          {working !== undefined && <SpeakerMark speaker={working} size="sm" active />}
          <span>{working === undefined ? "Les agents travaillent" : `${IDENTITIES[working].name} travaille`}</span>
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
    </section>
  );
}
