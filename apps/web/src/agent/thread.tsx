import type { ReactNode } from "react";
import { hrefTo } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Icon } from "../ui/icon.tsx";
import { IDENTITIES } from "./agents.ts";
import { eyeIdOf } from "./opened-look.ts";
import { shows, type Frame, type ShownStep, type ThreadFilter } from "./playback.ts";
import { elapsedText } from "./session-facts.ts";
import type { NoteStep, OutcomeStep, PassStep, PlanStep, SayStep, Speaker, ToolStep, VerdictStep } from "./session-script.ts";
import { SpeakerMark } from "./speaker-mark.tsx";
import { turnsOf, type Turn } from "./turns.ts";

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
  /** Whether the session still goes on: an empty thread then waits for its first events. */
  readonly live: boolean;
}

/** What the links of a thread need to come back to it. */
interface Back {
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly lookIndex: number | undefined;
  /** The only speaker the thread follows, if any. */
  readonly followed: Speaker | undefined;
}

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
        <Icon name="thought" size={13} />
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

/**
 * An action of an agent, in a line: what it did and how it ended; what the tool answered unfolds under it, and
 * its eye opens what the agent had before its eyes.
 */
function Action({ step, shown, back }: { readonly step: ToolStep; readonly shown: ShownStep; readonly back: Back }): ReactNode {
  const line = (
    <>
      <ActionState step={step} running={shown.running} />
      <Icon name={step.icon} size={13} />
      <span className="act-title">{step.title}</span>
      {!shown.running && step.durationMs !== undefined && <span className="act-time">{elapsedText(step.durationMs)}</span>}
    </>
  );
  const selected = back.lookIndex === shown.index;
  const look = step.look !== undefined && !shown.running && (
    <a
      id={eyeIdOf(shown.index)}
      className="act-look"
      href={hrefTo(back.path, { ...back.query, look: String(shown.index) })}
      aria-current={selected ? "true" : undefined}
      aria-label={`${step.title} — voir ce que l’agent avait sous les yeux`}
    >
      <Icon name="eye" size={13} />
    </a>
  );
  const className = selected ? "act selected" : "act";
  if (shown.running || step.detail === undefined) {
    return (
      <div className={className}>
        {line}
        {look}
      </div>
    );
  }
  return (
    <div className={className}>
      <details>
        <summary>{line}</summary>
        <pre className="act-result">{step.detail}</pre>
      </details>
      {look}
    </div>
  );
}

/**
 * What one agent thought, said and did in a row, under its name. The name follows the agent: it leaves that
 * agent alone in the thread, or brings the others back when the thread already follows it.
 */
function AgentTurn({ turn, back }: { readonly turn: Extract<Turn, { kind: "agent" }>; readonly back: Back }): ReactNode {
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

/** The notes of the harness that follow one another: one in a line, several folded under their count. */
function Notes({ items }: { readonly items: readonly ShownStep[] }): ReactNode {
  const texts = items.map(({ step }) => step as NoteStep);
  if (texts.length === 1) {
    return (
      <div className="notes single">
        <Icon name="shield" size={12} />
        <span className="note-text">{texts[0]!.text}</span>
      </div>
    );
  }
  return (
    <details className="notes">
      <summary>
        <Icon name="shield" size={12} />
        <span>{texts.length} notes du harnais</span>
        <span className="note-preview" aria-hidden="true">
          {texts.at(-1)!.text}
        </span>
      </summary>
      <ul>
        {texts.map((note, index) => (
          <li key={index}>
            <span className="turn-at">{note.at}</span> {note.text}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** A verdict of the harness: accepted on evidence, or refused with the gate that refused. */
function Verdict({ step }: { readonly step: VerdictStep }): ReactNode {
  return (
    <article className={step.accepted ? "verdict accepted" : "verdict refused"}>
      <header className="verdict-head">
        <SpeakerMark speaker="harness" size="sm" />
        <b>{IDENTITIES.harness.name}</b>
        <Badge tone={step.accepted ? "ok" : "ko"}>{step.accepted ? "accepté" : "refusé"}</Badge>
        {step.code !== undefined && <span className="verdict-code">{step.code}</span>}
        <span className="turn-role">{step.about}</span>
        <span className="turn-at">{step.at}</span>
      </header>
      <p className="verdict-text">{step.text}</p>
    </article>
  );
}

/** The plan of a pass, once accepted: its scenarios. */
function Plan({ step }: { readonly step: PlanStep }): ReactNode {
  return (
    <section className="result-card">
      <header>
        <span className="act-state ok" aria-hidden="true" />
        <b>{step.title}</b>
        <span className="turn-role">{step.scenarios.length} scénario(s)</span>
        <span className="turn-at">{step.at}</span>
      </header>
      {step.scenarios.map((scenario, index) => (
        <div key={index} className="result-row">
          <Badge tone="neutral">{scenario.priority}</Badge>
          <span className="result-title">{scenario.title}</span>
          <span className="turn-role">{scenario.source}</span>
        </div>
      ))}
    </section>
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

/** One turn of the thread, as its kind shows it. */
function TurnView({ turn, back }: { readonly turn: Turn; readonly back: Back }): ReactNode {
  if (turn.kind === "request") {
    return (
      <div className="request">
        <span className="sr-only">Votre demande : </span>
        {turn.shown.written}
      </div>
    );
  }
  if (turn.kind === "agent") return <AgentTurn turn={turn} back={back} />;
  if (turn.kind === "brief") return <Brief shown={turn.shown} />;
  if (turn.kind === "notes") return <Notes items={turn.items} />;
  const { step } = turn.shown;
  if (step.kind === "verdict") return <Verdict step={step} />;
  if (step.kind === "plan") return <Plan step={step} />;
  if (step.kind === "pass") return <Pass step={step} />;
  return <Outcome step={step as OutcomeStep} />;
}

/**
 * The thread of a session, as a conversation: what was asked, then each agent in turn — what it thought,
 * folded, what it said, and what it did, a line per action — the verdicts of the harness, the plans, and
 * what the session produced. While the session goes on, its last line names who is at work.
 *
 * @param props - The session at this moment.
 * @returns The thread.
 */
export function Thread({ path, frame, lookIndex, filter = "all", followed, query = {}, live }: ThreadProps): ReactNode {
  const turns = turnsOf(frame.shown.filter(({ step }) => shows(step, filter, followed)));
  const back: Back = { path, query, lookIndex, followed };
  const working = frame.speaking === undefined || frame.speaking === "user" ? undefined : frame.speaking;
  return (
    <section className="thread" aria-label="Fil de la session">
      {frame.shown.length === 0 && (
        <EmptyState title={live ? "Les agents n’ont encore rien écrit" : "Cette session n’a laissé aucun événement"}>
          {live ? "Le fil se remplira dès leur premier événement." : "Elle s’est arrêtée avant que ses agents ne commencent."}
        </EmptyState>
      )}
      {turns.map((turn, index) => (
        <div key={index} className="thread-item">
          <TurnView turn={turn} back={back} />
        </div>
      ))}
      {live && frame.shown.length > 0 && (
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
      <div className="thread-end" />
    </section>
  );
}
