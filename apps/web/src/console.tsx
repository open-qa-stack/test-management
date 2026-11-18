import type { FormEvent, ReactNode } from "react";
import type { Project, Session } from "@open-qa-stack/shared/sessions";
import { AgentHomeScreen } from "./agent/agent-home-screen.tsx";
import type { Opening } from "./agent/console-state.ts";
import type { LiveSession } from "./agent/live-session.ts";
import { SessionScreen } from "./agent/session-screen.tsx";
import { hrefTo, type Route } from "./routing/route.ts";
import { Shell } from "./shell/shell.tsx";
import { EmptyState } from "./ui/empty-state.tsx";
import { Page } from "./ui/page.tsx";

/** What the console is drawn from. */
export interface ConsoleProps {
  /** Where the console is. */
  readonly route: Route;
  /** The project, once the API described it. */
  readonly project?: Project;
  /** The sessions of the project, the latest first; `undefined` before the API listed them. */
  readonly sessions?: readonly Session[];
  /** Why the API could not list the sessions, when it answered so. */
  readonly unlisted?: string;
  /** Whether the instance could not be reached when last called. */
  readonly unreachable?: boolean;
  /** The session the route opens, once the API told it. */
  readonly live?: LiveSession;
  /** Whether the instance said it keeps no session of the name the route opens. */
  readonly missing?: boolean;
  /** Where the opening of a session is; nothing asked by default. */
  readonly opening?: Opening;
  /** Opens the session the form of the entry asks for. */
  readonly onOpen?: (event: FormEvent<HTMLFormElement>) => void;
}

/**
 * What the console shows: the entry of the agent, a session, the wait for one that is being read, or a page
 * that says the instance keeps no such session, or that the address leads nowhere.
 */
type Shown =
  | { readonly screen: "entry" | "no_session" | "nowhere" }
  | { readonly screen: "session"; readonly live: LiveSession }
  | { readonly screen: "opening"; readonly id: string };

/** The title of each screen that has one of its own; a session is titled by what was asked. */
const TITLES: Readonly<Record<Exclude<Shown["screen"], "session">, string>> = {
  entry: "Agent",
  opening: "Ouverture de la session…",
  no_session: "Session introuvable",
  nowhere: "Page introuvable",
};

/**
 * The session a route opens.
 *
 * @param route - The route.
 * @returns The identifier at `/agent/sessions/<id>`; `undefined` for any other route.
 */
export function sessionAt(route: Route): string | undefined {
  const [section, part, id, ...rest] = route.path;
  return section === "agent" && part === "sessions" && id !== undefined && rest.length === 0 ? id : undefined;
}

/**
 * Tells whether a route opens the entry of the agent.
 *
 * @param route - The route.
 * @returns Whether it is the home, or the address of the agent.
 */
export function isEntry(route: Route): boolean {
  return route.path.length === 0 || (route.path.length === 1 && route.path[0] === "agent");
}

/** What the console shows: a session once the API told the one the route opens, a wait until it did or said it keeps none. */
function shownOf({ route, live, missing = false }: ConsoleProps): Shown {
  if (isEntry(route)) return { screen: "entry" };
  const id = sessionAt(route);
  if (id === undefined) return { screen: "nowhere" };
  if (live?.script.id === id) return { screen: "session", live };
  return missing ? { screen: "no_session" } : { screen: "opening", id };
}

/**
 * The title of the page, as the browser names its tab and its history.
 *
 * @param props - The route, and what the API told.
 * @returns The title of the screen the console shows, then the name of the product.
 */
export function documentTitleOf(props: ConsoleProps): string {
  const shown = shownOf(props);
  return `${shown.screen === "session" ? shown.live.script.title : TITLES[shown.screen]} · Open QA Stack`;
}

/** The screen of a route: the entry of the agent, a session, or a page that says where the address leads. */
function Screen(props: ConsoleProps): ReactNode {
  const { route, project, sessions, unlisted, opening = { state: "idle" }, onOpen } = props;
  const name = project?.name ?? "Projet";
  const shown = shownOf(props);
  const back = <a href={hrefTo("/agent")}>Revenir aux sessions</a>;
  switch (shown.screen) {
    case "entry":
      return (
        <AgentHomeScreen
          project={name}
          opening={opening}
          {...(sessions === undefined ? {} : { sessions })}
          {...(unlisted === undefined ? {} : { unlisted })}
          {...(onOpen === undefined ? {} : { onOpen })}
        />
      );
    case "session":
      return <SessionScreen route={route} live={shown.live} project={name} />;
    case "opening":
      return (
        <Page crumbs={[{ label: name }, { label: "Agent", href: hrefTo("/agent") }, { label: shown.id }]} title={TITLES.opening}>
          <EmptyState title="Lecture de la session" action={back}>
            Son fil apparaît dès que l’instance a répondu.
          </EmptyState>
        </Page>
      );
    case "no_session":
      return (
        <Page crumbs={[{ label: name }, { label: TITLES.no_session }]} title={TITLES.no_session}>
          <EmptyState title="Le projet ne garde aucune session de ce nom" action={back}>
            Elle a peut-être été supprimée.
          </EmptyState>
        </Page>
      );
    case "nowhere":
      return (
        <Page crumbs={[{ label: name }, { label: TITLES.nowhere }]} title={TITLES.nowhere}>
          <EmptyState title="Cette adresse ne mène à aucun écran" action={back}>
            Le lien est peut-être ancien, ou l’écran n’existe pas encore.
          </EmptyState>
        </Page>
      );
  }
}

/**
 * The console at a route: its screen, in the shell.
 *
 * @param props - The route, and what the API told.
 * @returns The console.
 */
export function Console(props: ConsoleProps): ReactNode {
  const { route, project, unreachable = false } = props;
  return (
    <Shell route={route} unreachable={unreachable} {...(project === undefined ? {} : { project })}>
      <Screen {...props} />
    </Shell>
  );
}
