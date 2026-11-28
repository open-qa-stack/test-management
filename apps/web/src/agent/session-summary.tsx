import type { ReactNode } from "react";
import { durationText, hourText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { CopyButton } from "../ui/copy-button.tsx";
import { Icon } from "../ui/icon.tsx";
import { identityOf } from "./agents.ts";
import type { LiveSession } from "./live-session.ts";
import { SessionBar } from "./session-bar.tsx";
import { PhaseMark, phaseTitle } from "./phase-row.tsx";
import { groupsOf, type PhaseGroup, type PhaseView } from "./session-phases.ts";

/** A fact of the summary: what it measures, its value, and what goes with it. */
function Fact({ label, value, children }: { readonly label: string; readonly value: ReactNode; readonly children?: ReactNode }): ReactNode {
  return (
    <div className="summary-fact">
      <dt>{label}</dt>
      <dd>
        <b className="summary-value">{value}</b>
        {children}
      </dd>
    </div>
  );
}

/** How a group of phases reads on the line of the state of a session: its title, and how many passes it holds. */
function groupTitle(group: PhaseGroup): string {
  if (group.count === 1) return phaseTitle(group);
  return group.family === "plan" ? t("phases.planPasses", { count: group.count }) : `${phaseTitle(group)} × ${group.count}`;
}

/** The line of the state of the phases of a session, those of one family in a row gathered. */
function PhaseLine({ phases }: { readonly phases: readonly PhaseView[] }): ReactNode {
  if (phases.length === 0) return undefined;
  return (
    <ol className="phase-line" aria-label={t("phases.label")}>
      {groupsOf(phases).map((group, index) => (
        <li key={index} className={group.state}>
          <PhaseMark state={group.state} />
          {groupTitle(group)}
        </li>
      ))}
    </ol>
  );
}

/** What the agents of a session that goes on do now: who works, and on what, or that it waits for an agent. */
function nowText(live: LiveSession): string {
  if (live.session.state === "queued") return t("facts.waiting");
  const running = live.frame.shown.findLast(({ running, step }) => running && step.kind === "tool");
  const speaking = live.frame.speaking === undefined || live.frame.speaking === "user" ? undefined : live.frame.speaking;
  const who = speaking === undefined ? t("thread.agentsWork") : t("thread.agentWorks", { name: identityOf(speaking).name });
  return running?.step.kind === "tool" ? `${who} · ${running.step.title}` : who;
}

/**
 * The summary of a session, at the head of its page. While it goes on: what its agents do now, since when, how many
 * actions they did and the phase they are in, over a banner while its stream is cut. Once it ended: why, when it
 * stopped without ending, then the tests the harness closed, how long it took, the work of its agents and the branch
 * of its tests. Both end on the line of the state of its phases.
 *
 * @param props - The session, and its phases.
 * @returns The summary.
 */
export function SessionSummary({ live, phases }: { readonly live: LiveSession; readonly phases: readonly PhaseView[] }): ReactNode {
  const { session, frame, script } = live;
  const { result } = session;
  if (script.stage !== "ended") {
    const current = phases.at(-1);
    return (
      <section className="summary live" aria-label={t("summary.label")}>
        {live.stream === "reconnecting" && (
          <p className="summary-banner warn" role="status">
            <Icon name="warning" />
            {t("session.reconnecting")}
          </p>
        )}
        <p className="summary-now" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>{nowText(live)}</span>
        </p>
        <dl className="summary-facts">
          <Fact label={t("summary.opened")} value={hourText(session.openedAt)} />
          <Fact label={t("summary.phase")} value={current === undefined ? "—" : phaseTitle(current)} />
          <Fact label={t("summary.actions")} value={frame.actions} />
        </dl>
        <PhaseLine phases={phases} />
      </section>
    );
  }
  return (
    <section className="summary" aria-label={t("summary.label")}>
      {session.state === "interrupted" && (
        <div className="summary-banner warn">
          <Icon name="warning" />
          <p>
            <b>{t("summary.interrupted")}</b> {t("summary.kept")}
          </p>
        </div>
      )}
      <dl className="summary-facts">
        <Fact label={t("summary.tests")} value={result?.tests.length ?? 0}>
          <SessionBar session={session} />
        </Fact>
        {result !== undefined && (
          <Fact label={t("summary.duration")} value={durationText(result.durationMs)}>
            <span className="summary-detail">{`${hourText(session.openedAt)} → ${hourText(session.lastEventAt)}`}</span>
          </Fact>
        )}
        <Fact label={t("summary.work")} value={t("facts.actions", { count: frame.actions })}>
          {result !== undefined && <span className="summary-detail">{t("facts.modelRequests", { count: result.modelRequests })}</span>}
        </Fact>
        {result?.branch !== undefined && (
          <Fact label={t("summary.branch")} value={<code className="summary-branch">{result.branch}</code>}>
            <CopyButton text={result.branch} label={t("summary.copyBranch")} />
          </Fact>
        )}
      </dl>
      <PhaseLine phases={phases} />
    </section>
  );
}
