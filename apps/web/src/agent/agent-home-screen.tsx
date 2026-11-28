import type { FormEvent, ReactNode } from "react";
import type { Session } from "@open-qa-stack/domain/sessions";
import { durationText, momentText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { hrefTo } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { testsHref } from "../tests/tests-screen.tsx";
import type { Opening } from "./console-state.ts";
import type { ScopeChoices } from "./scope-choices.ts";
import { RequestForm } from "./request-form.tsx";
import { SessionBar } from "./session-bar.tsx";
import { scopeText, stateOf, waitText } from "./session-facts.ts";

/** What the entry of the agent needs. */
export interface AgentHomeScreenProps {
  /** The name of the project, which opens the breadcrumb. */
  readonly project: string;
  /** The sessions of the project, the latest first; `undefined` before the API listed them. */
  readonly sessions?: readonly Session[];
  /** Why the API could not list the sessions, when it answered so and none is listed yet. */
  readonly unlisted?: string;
  /** Where the opening of a session is. */
  readonly opening: Opening;
  /** The request the address already writes; none by default. */
  readonly request?: string;
  /** Opens the session the form asks for. */
  readonly onOpen?: (event: FormEvent<HTMLFormElement>) => void;
  /** What a session may be kept to; none until the configuration was read. */
  readonly choices?: ScopeChoices;
  /** What the project holds to start from, once the instance told it. */
  readonly existing?: Existing;
}

/** What the project holds to start a session from: the tests that failed last, those to review, the domains of the cartography. */
export interface Existing {
  readonly failing: number;
  readonly toReview: number;
  readonly domains: number;
}

/**
 * Where a person can start from what the project holds: the tests that failed last, the tests the agents wrote that
 * wait for a decision, and the domains the cartography found; each that holds nothing is left out.
 */
function StartFrom({ existing }: { readonly existing: Existing }): ReactNode {
  const ways = [
    { count: existing.failing, key: "failing", tone: "ko", href: testsHref({ outcome: "failed" }) },
    { count: existing.toReview, key: "review", tone: "ai", href: hrefTo("/review") },
    { count: existing.domains, key: "domains", tone: "info", href: hrefTo("/discovery") },
  ] as const;
  const shown = ways.filter(({ count }) => count > 0);
  if (shown.length === 0) return null;
  return (
    <section className="agent-home-start" aria-labelledby="agent-home-start">
      <h2 id="agent-home-start" className="grp">
        {t("home.startFrom")}
      </h2>
      <div className="agent-home-ways">
        {shown.map(({ count, key, tone, href }) => (
          <a key={key} className={`agent-home-way ${tone}`} href={href}>
            <b>{t(`home.ways.${key}.title`, { count })}</b>
            <span className="small muted">{t(`home.ways.${key}.note`, { count })}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

/** A session of the list: what was asked, when, what it waits for or how it went, and the link to its thread. */
function SessionRow({ session }: { readonly session: Session }): ReactNode {
  const state = stateOf(session);
  const live = session.state === "running";
  const facts = [
    momentText(session.openedAt),
    session.environment,
    scopeText(session),
    waitText(session),
    session.result === undefined ? undefined : durationText(session.result.durationMs),
  ].filter((fact) => fact !== undefined);
  return (
    <a className={live ? "row run-row live" : "row run-row"} href={hrefTo(`/agent/sessions/${session.id}`)}>
      <div className="grow">
        <div className="agent-home-session">
          <span className="agent-home-request">
            {session.purpose === "map" ? t("home.mapping") : (session.request ?? t(live ? "home.running" : "home.unasked"))}
          </span>
          <Badge tone={state.tone}>{state.label}</Badge>
        </div>
        <div className="small muted">{facts.join(" · ")}</div>
      </div>
      <span className="run-row-side">
        <SessionBar session={session} />
      </span>
    </a>
  );
}

/**
 * The entry of the agent: the request to write, which opens a session, and the sessions of the project, the one whose agents are working first, each leading to its thread.
 *
 * @param props - The project, its sessions, and the opening of a session.
 * @returns The screen.
 */
export function AgentHomeScreen({ project, sessions, unlisted, opening, request, onOpen, choices, existing }: AgentHomeScreenProps): ReactNode {
  const live = sessions?.filter(({ state }) => state === "running") ?? [];
  return (
    <Page crumbs={[{ label: project }, { label: t("console.titles.entry") }]}>
      <div className="agent-home">
        <h1 className="agent-home-title" tabIndex={-1}>
          {t("home.title")}
        </h1>
        <RequestForm
          opening={opening}
          {...(request === undefined ? {} : { request })}
          {...(onOpen === undefined ? {} : { onOpen })}
          {...(choices === undefined ? {} : { choices })}
        />
        {existing !== undefined && <StartFrom existing={existing} />}
        <Card className="agent-home-sessions" title={t("home.sessions")} hint={live.length > 0 ? t("home.live", { count: live.length }) : t("home.hint")}>
          {sessions === undefined && (
            <div className="row small muted" role="status">
              {unlisted ?? t("home.reading")}
            </div>
          )}
          {sessions?.length === 0 && <EmptyState title={t("home.emptyTitle")}>{t("home.emptyBody")}</EmptyState>}
          {sessions?.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </Card>
      </div>
    </Page>
  );
}
