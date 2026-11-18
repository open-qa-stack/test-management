import type { FormEvent, ReactNode } from "react";
import type { Project, Session } from "@open-qa-stack/domain/sessions";
import { AgentHomeScreen } from "./agent/agent-home-screen.tsx";
import type { Opening } from "./agent/console-state.ts";
import type { LiveSession } from "./agent/live-session.ts";
import { SessionScreen } from "./agent/session-screen.tsx";
import { ConfigurationPage } from "./configuration/configuration-page.tsx";
import { hrefTo, type Route } from "./routing/route.ts";
import { t } from "./i18n/i18n.ts";
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
  /** Reads the project again once the configuration, which names its applications, was saved. */
  readonly onConfigured?: () => void;
}

/**
 * What the console shows: the entry of the agent, a session, the wait for one that is being read, or a page
 * that says the instance keeps no such session, or that the address leads nowhere.
 */
type Shown =
  | { readonly screen: "entry" | "configuration" | "no_session" | "nowhere" }
  | { readonly screen: "session"; readonly live: LiveSession }
  | { readonly screen: "opening"; readonly id: string };

/** The title of a screen that has one of its own; a session is titled by what was asked. */
function titleOf(screen: Exclude<Shown["screen"], "session">): string {
  return t(`console.titles.${screen}`);
}

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
  if (route.path.length === 1 && route.path[0] === "configuration") return { screen: "configuration" };
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
  return `${shown.screen === "session" ? shown.live.script.title : titleOf(shown.screen)} · Open QA Stack`;
}

/** The screen of a route: the entry of the agent, a session, the configuration, or a page that says where the address leads. */
function Screen(props: ConsoleProps): ReactNode {
  const { route, project, sessions, unlisted, opening = { state: "idle" }, onOpen, onConfigured } = props;
  const name = project?.name ?? t("console.project");
  const shown = shownOf(props);
  const back = <a href={hrefTo("/agent")}>{t("console.back")}</a>;
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
    case "configuration":
      return <ConfigurationPage project={name} {...(onConfigured === undefined ? {} : { onSaved: onConfigured })} />;
    case "opening":
      return (
        <Page crumbs={[{ label: name }, { label: t("console.titles.entry"), href: hrefTo("/agent") }, { label: shown.id }]} title={titleOf("opening")}>
          <EmptyState title={t("console.opening.title")} action={back}>
            {t("console.opening.body")}
          </EmptyState>
        </Page>
      );
    case "no_session":
      return (
        <Page crumbs={[{ label: name }, { label: titleOf("no_session") }]} title={titleOf("no_session")}>
          <EmptyState title={t("console.noSession.title")} action={back}>
            {t("console.noSession.body")}
          </EmptyState>
        </Page>
      );
    case "nowhere":
      return (
        <Page crumbs={[{ label: name }, { label: titleOf("nowhere") }]} title={titleOf("nowhere")}>
          <EmptyState title={t("console.nowhere.title")} action={back}>
            {t("console.nowhere.body")}
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
