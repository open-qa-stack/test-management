import type { ReactNode } from "react";
import { turnsOf, type Speaker } from "@open-qa-stack/domain/sessions";
import { dayText, hourText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { hrefTo, type Route } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { Icon } from "../ui/icon.tsx";
import { Page } from "../ui/page.tsx";
import { AGENTS, identityOf } from "./agents.ts";
import { Composer } from "./composer.tsx";
import type { LiveSession } from "./live-session.ts";
import { LookPanel } from "./look-panel.tsx";
import { openedLookOf, withoutLook } from "./opened-look.ts";
import { DEFAULT_VIEW, type ThreadView } from "./playback.ts";
import { stateOf } from "./session-facts.ts";
import { conversationOf, type SessionEnding } from "./session-phases.ts";
import { SessionSummary } from "./session-summary.tsx";
import { StopConfirmation } from "./stop-confirmation.tsx";
import { asksToStop, STOP_CONTROL_ID, withoutStop, withStop } from "./stop-request.ts";
import { Thread } from "./thread.tsx";

/** What the screen of a session needs. */
export interface SessionScreenProps {
  readonly route: Route;
  readonly live: LiveSession;
  /** The name of the project, which opens the breadcrumb. */
  readonly project: string;
}

/** What the conversation shows besides what is said, as the address tells it: `?verdicts=off`, `?actions=on`. */
function viewOf(route: Route): ThreadView {
  return { verdicts: route.query["verdicts"] !== "off", actions: route.query["actions"] === "on" };
}

/** The parameters of the address that tell a view, those of the view shown by default left out. */
function queryOf(view: ThreadView): Record<string, string> {
  return { ...(view.verdicts === DEFAULT_VIEW.verdicts ? {} : { verdicts: "off" }), ...(view.actions === DEFAULT_VIEW.actions ? {} : { actions: "on" }) };
}

/** Where a session is, as its phases tell it. */
function endingOf(live: LiveSession): SessionEnding {
  if (live.script.stage !== "ended") return "live";
  return live.session.state === "interrupted" ? "interrupted" : "ended";
}

/**
 * How the person stops a session that goes on: the link to its confirmation or, once the instance took the request,
 * the word that it was asked — the session goes on until the process that runs it obeyed.
 */
function StopControl({ route, live }: { readonly route: Route; readonly live: LiveSession }): ReactNode {
  if (live.stopping.state === "asked")
    return (
      <span id={STOP_CONTROL_ID} className="session-stopping" role="status" tabIndex={-1}>
        {t("session.stopAsked")}
      </span>
    );
  return (
    <a id={STOP_CONTROL_ID} className="btn danger" href={withStop(route)}>
      <Icon name="stop" /> {t("session.stop")}
    </a>
  );
}

/** The actions of a session, the primary one last: stop it while it goes on; once it ended, replay it, and pick it up where it stopped when it did not end. */
function Actions({ route, live }: { readonly route: Route; readonly live: LiveSession }): ReactNode {
  if (live.script.stage !== "ended") return <StopControl route={route} live={live} />;
  return (
    <>
      <button type="button" className="btn" onClick={live.controls.restart} disabled={live.script.steps.length === 0}>
        <Icon name="restart" /> {t("session.replay")}
      </button>
      {live.session.state === "interrupted" && (
        <button type="button" className="btn primary" onClick={live.controls.pickUp} disabled={live.saying.state === "sending"}>
          {t("session.pickUp")}
        </button>
      )}
    </>
  );
}

/**
 * The bar of a session that is replayed: its pace, and the way back to the session as it is now. The names of
 * its first controls are in elements of their own, which a narrow screen leaves to a screen reader.
 */
function ReplayBar({ live }: { readonly live: LiveSession }): ReactNode {
  const { playback, frame, controls } = live;
  return (
    <div className="session-bar replay">
      <button type="button" className="btn primary sm" onClick={controls.toggle}>
        <Icon name={playback.playing ? "pause" : "play"} />
        <span className="btn-label">{t(playback.playing ? "session.pause" : "session.resume")}</span>
      </button>
      <button type="button" className="btn ghost sm" onClick={controls.skip} aria-label={t("session.nextVerdict")}>
        <Icon name="forward" />
        <span className="btn-label">{t("session.nextVerdictShort")}</span>
      </button>
      <button type="button" className="btn ghost sm playback-speed" onClick={controls.faster} aria-label={t("session.speed")}>
        × {playback.speed}
      </button>
      <div
        className="playback-progress"
        role="progressbar"
        aria-label={t("session.progress")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(frame.progress * 100)}
      >
        <i style={{ width: `${Math.round(frame.progress * 100)}%` }} />
      </div>
      <button type="button" className="btn ghost sm" onClick={controls.follow}>
        {t(live.script.stage === "live" ? "session.backToLive" : "session.showAll")}
      </button>
    </div>
  );
}

/** What the conversation shows besides what is said, two switches, and the way to open every phase or to fold them back. */
function ConversationHead({
  path,
  view,
  kept,
  allOpen,
}: {
  readonly path: string;
  readonly view: ThreadView;
  readonly kept: Readonly<Record<string, string>>;
  readonly allOpen: boolean;
}): ReactNode {
  const toggle = (part: keyof ThreadView): string =>
    hrefTo(path, { ...kept, ...queryOf({ ...view, [part]: !view[part] }), ...(allOpen ? { open: "all" } : {}) });
  return (
    <div className="conversation-head">
      <h2>{t("session.conversation")}</h2>
      <div className="conversation-view" role="group" aria-label={t("session.showAlso")}>
        <span className="conversation-also" aria-hidden="true">
          {t("session.showAlso")}
        </span>
        {(["verdicts", "actions"] as const).map((part) => (
          <a key={part} className={view[part] ? "chip on" : "chip"} href={toggle(part)} role="switch" aria-checked={view[part]}>
            <Icon name={view[part] ? "check" : "plus"} />
            {t(`session.show.${part}`)}
          </a>
        ))}
        <a className="btn sm" href={hrefTo(path, { ...kept, ...queryOf(view), ...(allOpen ? {} : { open: "all" }) })}>
          {t(allOpen ? "session.foldAll" : "session.unfoldAll")}
        </a>
      </div>
    </div>
  );
}

/**
 * A session, named by its day and its hour, under its state and what was asked: its summary, then its conversation,
 * each phase on a line that unfolds, followed as the agents work or replayed, over the composer of a message to the
 * agents: one sent while it goes on is delivered to the next agent that takes the hand, and one sent once it ended
 * resumes it. Until then its stop is behind a confirmation the address opens (`?stop=ask`). What an agent had before
 * its eyes when it acted opens in a panel, from the eye of that action: the address names the action (`?look=6`).
 *
 * @param props - The route, the session and the project.
 * @returns The screen.
 */
export function SessionScreen({ route, live, project }: SessionScreenProps): ReactNode {
  const { script, playback, frame, session } = live;
  const path = `/agent/sessions/${script.id}`;
  const opened = openedLookOf(route, script);
  const view = viewOf(route);
  const allOpen = route.query["open"] === "all";
  const followed = AGENTS.find((agent) => agent === route.query["agent"]) as Speaker | undefined;
  const kept = followed === undefined ? {} : { agent: followed };
  const query = { ...kept, ...queryOf(view), ...(allOpen ? { open: "all" } : {}) };
  const ending = endingOf(live);
  const { phases } = conversationOf(turnsOf(frame.shown), ending);
  const title = t("session.title", { day: dayText(session.openedAt), hour: hourText(session.openedAt) });
  const state = stateOf(session);
  return (
    <Page
      crumbs={[{ label: project }, { label: t("console.titles.entry"), href: hrefTo("/agent") }, { label: title }]}
      title={
        <>
          {title} <Badge tone={state.tone}>{state.label}</Badge>
        </>
      }
      hint={session.request === undefined ? undefined : <span className="session-request">{session.request}</span>}
      actions={<Actions route={route} live={live} />}
    >
      <div className="session">
        {asksToStop(route) && script.stage !== "ended" && live.stopping.state !== "asked" && (
          <StopConfirmation stopping={live.stopping} cancel={withoutStop(route)} onStop={live.controls.stop} />
        )}
        {!playback.following && <ReplayBar live={live} />}
        <SessionSummary live={live} phases={phases} />
        <ConversationHead path={path} view={view} kept={kept} allOpen={allOpen} />
        {followed !== undefined && (
          <a
            className="chip on followed-chip"
            href={hrefTo(path, { ...queryOf(view), ...(allOpen ? { open: "all" } : {}) })}
            aria-label={t("session.unfollow", { name: identityOf(followed).name })}
          >
            {identityOf(followed).name} ×
          </a>
        )}
        <Thread
          path={path}
          frame={frame}
          stage={script.stage}
          ending={ending}
          allOpen={allOpen}
          sources={script.sources.length}
          lookIndex={opened?.index}
          view={view}
          query={query}
          unfolded={live.unfolded}
          onUnfold={live.controls.unfold}
          {...(followed === undefined ? {} : { followed })}
        />
        <Composer saying={live.saying} ended={script.stage === "ended"} onSay={live.controls.say} onKey={live.controls.sayOnEnter} />
        <div className="session-end" />
        {opened !== undefined && <LookPanel opened={opened} close={withoutLook(route)} />}
      </div>
    </Page>
  );
}
