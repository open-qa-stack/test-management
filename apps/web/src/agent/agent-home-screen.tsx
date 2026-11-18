import type { FormEvent, ReactNode } from "react";
import type { Session } from "@open-qa-stack/domain/sessions";
import { hrefTo } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import type { Opening } from "./console-state.ts";
import { durationText, openingText, stateOf, testsText, waitText } from "./session-facts.ts";

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
  /** Opens the session the form asks for. */
  readonly onOpen?: (event: FormEvent<HTMLFormElement>) => void;
}

/** A session of the list: what was asked, when, what it waits for or how it went, and the link to its thread. */
function SessionRow({ session }: { readonly session: Session }): ReactNode {
  const state = stateOf(session);
  const live = session.state === "running";
  const facts = [
    openingText(session),
    session.environment,
    waitText(session),
    session.result === undefined ? undefined : durationText(session.result.durationMs),
    session.result === undefined ? undefined : `${session.result.modelRequests} requêtes au modèle`,
    testsText(session),
  ].filter((fact) => fact !== undefined);
  return (
    <a className={live ? "row run-row live" : "row run-row"} href={hrefTo(`/agent/sessions/${session.id}`)}>
      <div className="grow">
        <div className="agent-home-session">{session.request ?? (live ? "Session en cours" : "Session sans demande")}</div>
        <div className="small muted">{facts.join(" · ")}</div>
      </div>
      <Badge tone={state.tone}>{state.label}</Badge>
    </a>
  );
}

/**
 * The entry of the agent: the request to write, which opens a session, and the sessions of the project, the one whose agents are working first, each leading to its thread.
 *
 * @param props - The project, its sessions, and the opening of a session.
 * @returns The screen.
 */
export function AgentHomeScreen({ project, sessions, unlisted, opening, onOpen }: AgentHomeScreenProps): ReactNode {
  const live = sessions?.filter(({ state }) => state === "running") ?? [];
  const sending = opening.state === "sending";
  return (
    <Page crumbs={[{ label: project }, { label: "Agent" }]}>
      <div className="agent-home">
        <h1 className="agent-home-title" tabIndex={-1}>
          Qu’est-ce qu’on teste ?
        </h1>
        <form className="agent-home-prompt" onSubmit={onOpen}>
          <label className="sr-only" htmlFor="agent-home-request">
            Dites aux agents quoi tester
          </label>
          <textarea id="agent-home-request" name="request" required disabled={sending} placeholder="Une règle, un ticket, un écran, un parcours…" />
          <div className="agent-home-actions">
            {opening.state === "refused" && (
              <span className="small agent-home-refused" role="alert">
                {opening.message}
              </span>
            )}
            <button type="submit" className="btn primary" disabled={sending}>
              {sending ? "Ouverture…" : "Démarrer une session"}
            </button>
          </div>
        </form>
        <Card className="agent-home-sessions" title="Sessions" hint={live.length > 0 ? `${live.length} en direct` : "chaque demande ouvre une session"}>
          {sessions === undefined && (
            <div className="row small muted" role="status">
              {unlisted ?? "Lecture des sessions…"}
            </div>
          )}
          {sessions?.length === 0 && <EmptyState title="Aucune session pour l’instant">La première apparaîtra ici dès qu’une demande sera faite.</EmptyState>}
          {sessions?.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </Card>
      </div>
    </Page>
  );
}
