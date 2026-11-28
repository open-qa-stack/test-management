import type { ReactNode } from "react";
import { Trans } from "react-i18next/TransWithoutContext";
import { elapsedText } from "../i18n/formats.ts";
import { i18n, t } from "../i18n/i18n.ts";
import { levelName, statusCount, statusName, type Status } from "../i18n/vocabulary.ts";
import { hrefTo } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { Code } from "../ui/code.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Icon } from "../ui/icon.tsx";
import { identityOf } from "./agents.ts";
import { eyeIdOf } from "./opened-look.ts";
import { DEFAULT_VIEW, shows, type Frame, type ShownStep, type ThreadView } from "./playback.ts";
import {
  turnsOf,
  type NoteStep,
  type OutcomeStep,
  type PassStep,
  type RepeatedNoteStep,
  type SayStep,
  type SessionStage,
  type Speaker,
  type Step,
  type ToolStep,
  type Turn,
} from "@open-qa-stack/domain/sessions";
import { PlanCard } from "./plan-card.tsx";
import { ScopeCard } from "./scope-card.tsx";
import { SpeakerMark } from "./speaker-mark.tsx";
import { HarnessVerdict, ReviewVerdict } from "./verdict-card.tsx";
import { harnessText, isWorded, rowText } from "./harness-words.ts";
import { Fold } from "./fold.tsx";
import { RefusalGroup } from "./refusal-group.tsx";
import { stretchesOf, type WorkStretch } from "./work-stretches.ts";
import { iconOf } from "./tool-icon.ts";
import { PhaseRow } from "./phase-row.tsx";
import { conversationOf, type SessionEnding } from "./session-phases.ts";

/** What the thread of a session needs. */
export interface ThreadProps {
  /** The path of the session, which the links of the thread come back to. */
  readonly path: string;
  /** The session at this moment. */
  readonly frame: Frame;
  /** The rank of the action whose look is open, if any. */
  readonly lookIndex: number | undefined;
  /** What the thread shows besides what is said; the verdicts by default. */
  readonly view?: ThreadView;
  /** The only speaker the thread follows, if any. */
  readonly followed?: Speaker;
  /** The parameters of the address the links of the thread keep, such as its filter. */
  readonly query?: Readonly<Record<string, string>>;
  /** Where the session is: an empty thread says what it waits for, or that nothing will come. */
  readonly stage: SessionStage;
  /** Where the session is, as its phases tell it: the one its agents work in, or the one it stopped in. */
  readonly ending: SessionEnding;
  /** Whether every phase is open, whatever the person folded. */
  readonly allOpen?: boolean;
  /** How many sources the session read, which its cartography tells. */
  readonly sources: number;
  /** What of the thread the person unfolded, by key: `text-9` for the long text of the step 9, `actions-4` for the actions from the step 4, `stretch-3` for the stretch of work from the step 3, `phase-2` for the phase from the step 2 — folded, for a phase open by itself. */
  readonly unfolded: readonly string[];
  /** Unfolds a part of the thread, by its key, or folds it again. */
  readonly onUnfold: (key: string) => void;
}

/** What the links of a thread need to come back to it. */
interface Back {
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly lookIndex: number | undefined;
  /** The only speaker the thread follows, if any. */
  readonly followed: Speaker | undefined;
  readonly unfolded: readonly string[];
  readonly onUnfold: (key: string) => void;
}

/** The colour family of each verdict of a test the console words; any other reads as it is. */
const VERDICTS: Readonly<Record<string, readonly ["ok" | "ko" | "warn", Status]>> = {
  passed: ["ok", "passed"],
  failed: ["ko", "failed"],
  blocked: ["warn", "blocked"],
  skipped: ["warn", "skipped"],
  indeterminate: ["warn", "indeterminate"],
};

/** How a verdict of a test reads, and its colour family: as the console words it, or as it is. */
function verdictOf(verdict: string): readonly ["ok" | "ko" | "warn", string] {
  const known = VERDICTS[verdict];
  return known === undefined ? ["warn", verdict] : [known[0], statusName(known[1])];
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
  if (step.outcome === "passed") return <span className="act-state ok" role="img" aria-label={statusName("passed")} />;
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
 * The actions an agent did in a row, folded under one line: how many, how many failed, and the time they took
 * together, once their tools told it. They unfold while one of them runs, and when the look of one of them is open.
 */
function ActionGroup({ items, back }: { readonly items: readonly ShownStep[]; readonly back: Back }): ReactNode {
  const steps = items.map(({ step }) => step as ToolStep);
  const failed = steps.filter(({ outcome }) => outcome === "failed").length;
  const took = steps.reduce((sum, { durationMs }) => sum + (durationMs ?? 0), 0);
  return (
    <Fold
      id={`actions-${items[0]!.index}`}
      className="actions"
      forced={items.some(({ running, index }) => running || index === back.lookIndex)}
      unfolded={back.unfolded}
      onUnfold={back.onUnfold}
      summary={
        <>
          <Icon name="code" />
          <span className="actions-count">{t("thread.actions", { count: steps.length })}</span>
          {failed > 0 && <span className="actions-failed">{t("thread.actionsFailed", { count: failed })}</span>}
          {took > 0 && <span className="act-time">{elapsedText(took)}</span>}
        </>
      }
    >
      <div className="actions-list">
        {items.map((shown) => (
          <Action key={shown.index} step={shown.step as ToolStep} shown={shown} back={back} />
        ))}
      </div>
    </Fold>
  );
}

/** The items of a turn of an agent, the actions it did in a row gathered: a run of one action stays alone. */
function runsOf(items: readonly ShownStep[]): (ShownStep | readonly ShownStep[])[] {
  const runs: (ShownStep | ShownStep[])[] = [];
  for (const item of items) {
    const last = runs.at(-1);
    if (item.step.kind !== "tool") runs.push(item);
    else if (Array.isArray(last)) last.push(item);
    else runs.push([item]);
  }
  return runs.map((run) => (Array.isArray(run) && run.length === 1 ? run[0]! : run));
}

/**
 * What one agent thought, said and did in a row, under its name; the actions it did in a row folded under their count. The name follows the agent: it leaves that
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
        {runsOf(turn.items).map((run) => {
          if (Array.isArray(run)) return <ActionGroup key={run[0]!.index} items={run} back={back} />;
          const shown = run as ShownStep;
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

/** What a note says, on its line, in the words of the console: its text, or for a row of notes alike what they say of their sources. */
function noteTextOf(step: NoteStep | RepeatedNoteStep): string {
  return step.kind === "note" ? harnessText(step.text) : rowText(step);
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
            <span className="turn-at">{note.at}</span> {harnessText(note.text)}
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
              <span className="turn-at">{step.at}</span> {harnessText(step.text)}
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

/** How many tests passed, failed, and came to another verdict, as the head of what the session produced says it. */
function tallyOf(step: OutcomeStep): string {
  const passed = step.tests.filter(({ verdict }) => verdict === "passed").length;
  const failed = step.tests.filter(({ verdict }) => verdict === "failed").length;
  const other = step.tests.length - passed - failed;
  return [
    ...(passed === 0 ? [] : [statusCount("passed", passed)]),
    ...(failed === 0 ? [] : [statusCount("failed", failed)]),
    ...(other === 0 ? [] : [t("thread.otherCount", { count: other })]),
  ].join(" · ");
}

/**
 * Why a test came to its verdict, under its title: in the words of the console when the harness said it in a
 * form it knows, folded under the technical details when it is the raw answer of the runner, such as an error.
 */
function TestNote({ note }: { readonly note: string }): ReactNode {
  if (isWorded(note)) return <span className="turn-role">{harnessText(note)}</span>;
  return (
    <details className="raw result-raw">
      <summary>{t("thread.technical")}</summary>
      <pre>{note}</pre>
    </details>
  );
}

/** What the session produced: how many tests passed and failed, then the verdict of each test. */
function Outcome({ step }: { readonly step: OutcomeStep }): ReactNode {
  return (
    <section className="result-card outcome">
      <header>
        <b>{step.title}</b>
        <span className="outcome-tally">{tallyOf(step)}</span>
      </header>
      {step.tests.map((test, index) => {
        const [tone, label] = verdictOf(test.verdict);
        return (
          <div key={index} className="result-row">
            <Badge tone={tone}>{label}</Badge>
            <span className="result-title">{test.title}</span>
            {test.note === undefined ? <span className="turn-role">{levelName(test.level)}</span> : <TestNote note={test.note} />}
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
  if (turn.kind === "refusals") return <RefusalGroup items={turn.items} unfolded={back.unfolded} onUnfold={back.onUnfold} />;
  const { step } = turn.shown;
  if (step.kind === "review") return <ReviewVerdict step={step} running={turn.shown.running} />;
  if (step.kind === "verdict" && !step.accepted) return <RefusalGroup items={[turn.shown]} unfolded={back.unfolded} onUnfold={back.onUnfold} />;
  if (step.kind === "verdict") {
    const { index } = turn.shown;
    return <HarnessVerdict step={step} index={index} open={back.unfolded.includes(`text-${index}`)} onUnfold={() => back.onUnfold(`text-${index}`)} />;
  }
  if (step.kind === "plan") return <PlanCard step={step} />;
  if (step.kind === "scope") return <ScopeCard step={step} />;
  if (step.kind === "pass") return <Pass step={step} />;
  return <Outcome step={step as OutcomeStep} />;
}

/**
 * A stretch of work, on one line: the agents at work, how many actions they did and how many failed, how many
 * times the harness refused, how many notes it wrote, and the time the actions took; each turn unfolds under it as it was. It is open while
 * one of its steps runs, and when the look of one of its actions is.
 */
function Stretch({ stretch, back }: { readonly stretch: WorkStretch; readonly back: Back }): ReactNode {
  const ranks = stretch.turns.flatMap((turn) => ("items" in turn ? turn.items : [turn.shown]).map(({ index }) => index));
  return (
    <Fold
      id={`stretch-${ranks[0]!}`}
      className="stretch"
      forced={stretch.running || ranks.includes(back.lookIndex ?? -1)}
      unfolded={back.unfolded}
      onUnfold={back.onUnfold}
      summary={
        <>
          <span className="stretch-marks">
            {(stretch.agents.length === 0 ? (["harness"] as const) : stretch.agents).map((speaker) => (
              <SpeakerMark key={speaker} speaker={speaker} size="sm" />
            ))}
          </span>
          <span className="stretch-what">
            {[
              ...(stretch.agents.length === 0 ? [] : [stretch.agents.map((agent) => identityOf(agent).name).join(", ")]),
              ...(stretch.actions === 0 ? [] : [t("thread.actions", { count: stretch.actions })]),
              ...(stretch.failed === 0 ? [] : [t("thread.actionsFailed", { count: stretch.failed })]),
              ...(stretch.refusals === 0 ? [] : [t("count.refusals", { count: stretch.refusals })]),
              ...(stretch.notes === 0 ? [] : [t("thread.notes", { count: stretch.notes })]),
            ].join(" · ")}
          </span>
          {stretch.actions > 0 && <span className="act-time">{elapsedText(stretch.durationMs)}</span>}
        </>
      }
    >
      <div className="stretch-turns">
        {stretch.turns.map((turn, rank) => (
          <TurnView key={rank} turn={turn} back={back} />
        ))}
      </div>
    </Fold>
  );
}

/** Whether a turn is a card of a kind of step. */
function isCard(turn: Turn<ShownStep> | undefined, kind: Step["kind"]): boolean {
  return turn?.kind === "card" && turn.shown.step.kind === kind;
}

/** The turns of a phase without the passes that hold nothing: one another pass follows at once, or that the phase ends on once nothing more will come. */
function withoutEmptyPasses(turns: readonly Turn<ShownStep>[], stage: SessionStage): Turn<ShownStep>[] {
  return turns.filter((turn, rank) => {
    if (!isCard(turn, "pass")) return true;
    const next = turns[rank + 1];
    return next === undefined ? stage === "live" : !isCard(next, "pass");
  });
}

/** Turns as the thread shows them, the work of the agents in a row folded into stretches. */
function Turns({ turns, back }: { readonly turns: readonly Turn<ShownStep>[]; readonly back: Back }): ReactNode {
  return stretchesOf(turns).map((entry, index) => (
    <div key={index} className="thread-item">
      {entry.kind === "stretch" ? <Stretch stretch={entry} back={back} /> : <TurnView turn={entry} back={back} />}
    </div>
  ));
}

/** What a session produced, in a few words, from the card of its outcome among turns. */
function tallyIn(turns: readonly Turn<ShownStep>[]): string | undefined {
  const card = turns.find((turn) => isCard(turn, "outcome"));
  return card?.kind === "card" ? tallyOf(card.shown.step as OutcomeStep) : undefined;
}

/**
 * The thread of a session, as a conversation: what was asked and what the person said before the agents started,
 * then each phase on a line that unfolds on its turns — each agent in turn, what it thought, folded, what it said
 * and what it did, its actions in a row folded under their count; the verdicts of the harness, its refusals alike
 * gathered, and the plans; what the session produced in its summary. The work of the agents in a row, without a word
 * of theirs, is folded under one line.
 *
 * @param props - The session at this moment.
 * @returns The thread.
 */
export function Thread(props: ThreadProps): ReactNode {
  const { path, frame, lookIndex, view = DEFAULT_VIEW, followed, query = {}, stage, ending, allOpen = false, sources, unfolded, onUnfold } = props;
  const { head, phases } = conversationOf(turnsOf(frame.shown.filter(({ step }) => shows(step, view, followed))), ending);
  const back: Back = { path, query, lookIndex, followed, unfolded, onUnfold };
  return (
    <section className="thread" aria-label={t("thread.label")}>
      {frame.shown.length === 0 && <EmptyState title={t(`thread.empty.${stage}.title`)}>{t(`thread.empty.${stage}.body`)}</EmptyState>}
      <Turns turns={head} back={back} />
      {phases.map((phase) => (
        <PhaseRow
          key={phase.key}
          phase={phase}
          sources={sources}
          tally={tallyIn(phase.turns)}
          allOpen={allOpen}
          forced={phase.turns.some((turn) => ("items" in turn ? turn.items : [turn.shown]).some(({ index }) => index === lookIndex))}
          unfolded={unfolded}
          onUnfold={onUnfold}
        >
          <Turns turns={withoutEmptyPasses(phase.turns, stage)} back={back} />
        </PhaseRow>
      ))}
    </section>
  );
}
