import type { ReactNode } from "react";
import { durationText, momentText } from "../i18n/formats.ts";
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
import { stateOf, waitText } from "./session-facts.ts";
import { passesOf, type ThreadFilter } from "./playback.ts";
import type { Speaker } from "@open-qa-stack/domain/sessions";
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

/** What the thread may keep. */
const FILTERS: readonly ThreadFilter[] = ["all", "talk", "actions", "verdicts"];

/** The facts of a session, in a line: when it was opened, what it waits for, how long it took, what its agents read and did, what it cost, where its tests are. */
function factsOf(live: LiveSession): string[] {
  const { session, frame, script } = live;
  const { result } = session;
  const waiting = waitText(session);
  return [
    momentText(session.openedAt),
    ...(waiting === undefined ? [] : [waiting]),
    ...(result === undefined ? [] : [durationText(result.durationMs)]),
    ...(script.sources.length === 0 ? [] : [t("facts.sourcesRead", { count: script.sources.length })]),
    t("facts.actions", { count: frame.actions }),
    ...(result === undefined ? [] : [t("facts.modelRequests", { count: result.modelRequests })]),
    ...(result?.branch === undefined ? [] : [result.branch]),
  ];
}

/**
 * What the bar of a session that goes on holds about its stop: the link to its confirmation or, once the
 * instance took the request, the word that it was asked — the session goes on until the process that runs it obeyed.
 */
function StopControl({ route, live }: { readonly route: Route; readonly live: LiveSession }): ReactNode {
  if (live.stopping.state === "asked")
    return (
      <span id={STOP_CONTROL_ID} className="session-stopping" role="status" tabIndex={-1}>
        {t("session.stopAsked")}
      </span>
    );
  return (
    <a id={STOP_CONTROL_ID} className="btn ghost sm" href={withStop(route)}>
      <Icon name="stop" /> {t("session.stop")}
    </a>
  );
}

/** The bar of a session that is followed: its state, its facts, the way to stop it while it goes on, and the replay it offers. */
function FollowBar({ route, live }: { readonly route: Route; readonly live: LiveSession }): ReactNode {
  const state = stateOf(live.session);
  return (
    <div className="session-bar">
      <Badge tone={state.tone}>{state.label}</Badge>
      <span className="session-facts">{live.stream === "reconnecting" ? t("session.reconnecting") : factsOf(live).join(" · ")}</span>
      {live.script.stage !== "ended" && <StopControl route={route} live={live} />}
      <button type="button" className="btn ghost sm" onClick={live.controls.restart} disabled={live.script.steps.length === 0}>
        <Icon name="restart" /> {t("session.replay")}
      </button>
    </div>
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

/**
 * A session: its thread alone, followed as the agents work or replayed, over the composer of a message to the
 * agents: one sent while it waits its turn is delivered when its agents start, and one sent once it ended resumes it. Until
 * then its bar offers to stop it, behind a confirmation the address opens (`?stop=ask`). What an agent had before its eyes
 * when it acted opens in a panel, from the eye of that action: the address names the action (`?look=6`).
 *
 * @param props - The route, the session and the project.
 * @returns The screen.
 */
export function SessionScreen({ route, live, project }: SessionScreenProps): ReactNode {
  const { script, playback, frame } = live;
  const path = `/agent/sessions/${script.id}`;
  const opened = openedLookOf(route, script);
  const filter = FILTERS.find((name) => name === route.query["show"]) ?? "all";
  const followed = AGENTS.find((agent) => agent === route.query["agent"]) as Speaker | undefined;
  const kept = { ...(filter === "all" ? {} : { show: filter }), ...(followed === undefined ? {} : { agent: followed }) };
  return (
    <Page crumbs={[{ label: project }, { label: t("console.titles.entry"), href: hrefTo("/agent") }, { label: script.title }]} title={script.title}>
      <div className="session">
        {playback.following ? <FollowBar route={route} live={live} /> : <ReplayBar live={live} />}
        {asksToStop(route) && script.stage !== "ended" && live.stopping.state !== "asked" && (
          <StopConfirmation stopping={live.stopping} cancel={withoutStop(route)} onStop={live.controls.stop} />
        )}
        <div className="pass-stepper" aria-label={t("session.passes")}>
          {passesOf(script, frame).map((pass, index, passes) => (
            <span key={index} className="pass-step">
              <span className={pass.state === "done" ? "s done" : pass.state === "current" ? "s cur" : "s"}>
                <span className="n">{pass.state === "done" ? "✓" : index + 1}</span>
                {pass.title}
              </span>
              {index < passes.length - 1 && <span className="sep" />}
            </span>
          ))}
        </div>
        <div className="thread-filters">
          {FILTERS.map((name) => (
            <a
              key={name}
              className={name === filter ? "chip on" : "chip"}
              href={hrefTo(path, { ...(name === "all" ? {} : { show: name }), ...(followed === undefined ? {} : { agent: followed }) })}
              aria-current={name === filter ? "true" : undefined}
            >
              {t(`session.filters.${name}`)}
            </a>
          ))}
          {followed !== undefined && (
            <a
              className="chip on followed-chip"
              href={hrefTo(path, filter === "all" ? {} : { show: filter })}
              aria-label={t("session.unfollow", { name: identityOf(followed).name })}
            >
              {identityOf(followed).name} ×
            </a>
          )}
        </div>
        <Thread
          path={path}
          frame={frame}
          stage={script.stage}
          lookIndex={opened?.index}
          filter={filter}
          query={kept}
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
