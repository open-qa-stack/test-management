import type { ReactNode } from "react";
import { Trans } from "react-i18next/TransWithoutContext";
import { elapsedText } from "../i18n/formats.ts";
import { i18n, t } from "../i18n/i18n.ts";
import { hrefTo } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { Code } from "../ui/code.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Icon } from "../ui/icon.tsx";
import { identityOf } from "./agents.ts";
import { eyeIdOf } from "./opened-look.ts";
import { shows, type Frame, type ShownStep, type ThreadFilter } from "./playback.ts";
import {
  turnsOf,
  type NoteStep,
  type OutcomeStep,
  type PassStep,
  type RepeatedNoteStep,
  type SayStep,
  type SessionStage,
  type Speaker,
  type ToolStep,
  type Turn,
} from "@open-qa-stack/domain/sessions";
import { PlanCard } from "./plan-card.tsx";
import { ScopeCard } from "./scope-card.tsx";
import { SpeakerMark } from "./speaker-mark.tsx";
import { HarnessVerdict, ReviewVerdict } from "./verdict-card.tsx";
import { iconOf } from "./tool-icon.ts";

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

/** The colour family of each verdict of a test the console words; any other reads as it is. */
const VERDICTS: Readonly<Record<string, readonly ["ok" | "ko" | "warn", "passed" | "failed" | "blocked"]>> = {
  passed: ["ok", "passed"],
  failed: ["ko", "failed"],
  blocked: ["warn", "blocked"],
};

/** How a verdict of a test reads, and its colour family: as the console words it, or as it is. */
function verdictOf(verdict: string): readonly ["ok" | "ko" | "warn", string] {
  const known = VERDICTS[verdict];
  return known === undefined ? ["warn", verdict] : [known[0], t(`thread.verdicts.${known[1]}`)];
}

/** A reasoning of an agent: folded to its first line once written, open while it is being written. */
function Thinking({ step, shown }: { readonly step: SayStep; readonly shown: ShownStep }): ReactNode {
  return (
    <details className="thinking" open={shown.running}>
      <summary>
        <Icon name="thought" />
        <span className="thinking-label">{t("thread.thinking")}</span>
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
  if (running) return <span className="spinner" role="img" aria-label={t("thread.running")} />;
  if (step.outcome === "failed") return <span className="act-state ko" role="img" aria-label={t("thread.failure")} />;
  if (step.outcome === "passed") return <span className="act-state ok" role="img" aria-label={t("thread.verdicts.passed")} />;
  return <span className="act-state" aria-hidden="true" />;
}

/** What a run of a file of tests ran, a test a row: its verdict, then its title. */
function RanTests({ step }: { readonly step: ToolStep }): ReactNode {
  return (
    <ul className="act-tests">
      {step.tests!.map((test, index) => {
        const [tone, label] = verdictOf(test.verdict);
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
  const ran = !shown.running && step.tests !== undefined && step.outcome !== undefined;
  const title = <span className="act-title">{ran ? t("thread.ran", { title: step.title, verdict: verdictOf(step.outcome!)[1] }) : step.title}</span>;
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
      aria-label={t(step.look.kind === "file" ? "thread.lookFile" : "thread.lookPage", { title: step.title })}
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
          {file !== undefined && <Code lines={file.lines} className="act-code" />}
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
  const { name, role } = identityOf(turn.agent);
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
            aria-label={t(follows ? "thread.followAll" : "thread.followOne", { name })}
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
          <Trans i18n={i18n} i18nKey="thread.brief" values={{ from: identityOf("harness").name, to: identityOf(step.to!).name }} components={{ b: <b /> }} />
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
        <span className="note-count">{t("count.sources", { count: step.sources.length })}</span>
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
        <span>{t("thread.notes", { count: steps.length })}</span>
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
        const [tone, label] = verdictOf(test.verdict);
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
        <span className="sr-only">{t("thread.yourMessage")}</span>
        {turn.shown.written}
      </div>
      <span className="sent-status">
        {turn.deliveredTo === undefined ? t("facts.waiting") : t("thread.deliveredTo", { name: identityOf(turn.deliveredTo).name })}
      </span>
    </div>
  );
}

/** One turn of the thread, as its kind shows it. */
function TurnView({ turn, back }: { readonly turn: Turn<ShownStep>; readonly back: Back }): ReactNode {
  if (turn.kind === "request") {
    return (
      <div className="request">
        <span className="sr-only">{t("thread.yourRequest")}</span>
        {turn.shown.written}
      </div>
    );
  }
  if (turn.kind === "message") return <Message turn={turn} />;
  if (turn.kind === "agent") return <AgentTurn turn={turn} back={back} />;
  if (turn.kind === "brief") return <Brief shown={turn.shown} />;
  if (turn.kind === "notes") return <Notes items={turn.items} />;
  const { step } = turn.shown;
  if (step.kind === "review") return <ReviewVerdict step={step} running={turn.shown.running} />;
  if (step.kind === "verdict") {
    const { index } = turn.shown;
    return <HarnessVerdict step={step} index={index} open={back.unfolded.includes(index)} onUnfold={() => back.onUnfold(index)} />;
  }
  if (step.kind === "plan") return <PlanCard step={step} />;
  if (step.kind === "scope") return <ScopeCard step={step} />;
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
    <section className="thread" aria-label={t("thread.label")}>
      {frame.shown.length === 0 && <EmptyState title={t(`thread.empty.${stage}.title`)}>{t(`thread.empty.${stage}.body`)}</EmptyState>}
      {turns.map((turn, index) => (
        <div key={index} className="thread-item">
          <TurnView turn={turn} back={back} />
        </div>
      ))}
      {stage === "live" && frame.shown.length > 0 && (
        <div className="working" role="status">
          {working !== undefined && <SpeakerMark speaker={working} size="sm" active />}
          <span>{working === undefined ? t("thread.agentsWork") : t("thread.agentWorks", { name: identityOf(working).name })}</span>
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
