import type { FormEvent, ReactNode } from "react";
import type { ExecutionOutcome, Project, Session } from "@open-qa-stack/domain/sessions";
import { AgentHomeScreen } from "./agent/agent-home-screen.tsx";
import type { Opening } from "./agent/console-state.ts";
import type { LiveSession } from "./agent/live-session.ts";
import { SessionScreen } from "./agent/session-screen.tsx";
import { ConfigurationPage } from "./configuration/configuration-page.tsx";
import { ExecutionPage } from "./executions/execution-page.tsx";
import { ExecutionsPage } from "./executions/executions-page.tsx";
import { ResultPage } from "./executions/result-page.tsx";
import { KnowledgePage } from "./knowledge/knowledge-page.tsx";
import { TestPage } from "./tests/test-page.tsx";
import { TestsPage } from "./tests/tests-page.tsx";
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
  | { readonly screen: "entry" | "configuration" | "knowledge" | "tests" | "no_session" | "nowhere" }
  | { readonly screen: "executions"; readonly outcome?: ExecutionOutcome; readonly before?: string }
  | { readonly screen: "execution"; readonly id: string }
  | { readonly screen: "result"; readonly id: string; readonly path: string; readonly step?: number }
  | { readonly screen: "test"; readonly path: string }
  | { readonly screen: "session"; readonly live: LiveSession }
  | { readonly screen: "opening"; readonly id: string };

/** The words of each screen that says what stands in place of a session, by the screen. */
const NOTICES = { opening: "opening", no_session: "noSession", nowhere: "nowhere" } as const;

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

/** The step of a test an address asks to show, when it names one by its number, from 1. */
function stepOf(step: string | undefined): { readonly step?: number } {
  return step !== undefined && /^[1-9]\d{0,3}$/.test(step) ? { step: Number(step) } : {};
}

/** The outcome a page of the executions is narrowed to, when the address names one the console knows. */
function outcomeOf(outcome: string | undefined): { readonly outcome?: ExecutionOutcome } {
  return outcome === "failing" || outcome === "passing" ? { outcome } : {};
}

/** A value the address gives, when it is not empty. */
function given(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

/** The screen of the executions an address under `/executions` opens: their list, one of them, or what came of a test in one. */
function executionsShown(part: string | undefined, query: Route["query"]): Shown | undefined {
  const { id, path, before } = query;
  if (part === undefined) return { screen: "executions", ...outcomeOf(query["outcome"]), ...(given(before) ? { before } : {}) };
  if (part === "view" && given(id)) return { screen: "execution", id };
  if (part === "result" && given(id) && given(path)) return { screen: "result", id, path, ...stepOf(query["step"]) };
  return undefined;
}

/** What the console shows: a session once the API told the one the route opens, a wait until it did or said it keeps none. */
function shownOf({ route, live, missing = false }: ConsoleProps): Shown {
  if (isEntry(route)) return { screen: "entry" };
  if (route.path.length === 1 && route.path[0] === "configuration") return { screen: "configuration" };
  if (route.path[0] === "knowledge" && route.path.length <= 2) return { screen: "knowledge" };
  if (route.path.length === 1 && route.path[0] === "tests") return { screen: "tests" };
  const executions = route.path[0] === "executions" && route.path.length <= 2 ? executionsShown(route.path[1], route.query) : undefined;
  if (executions !== undefined) return executions;
  const test = route.query["path"];
  if (route.path.length === 2 && route.path[0] === "tests" && route.path[1] === "view" && given(test)) return { screen: "test", path: test };
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

/** The screen of a route: the entry of the agent, a session, the configuration, the knowledge, or a page that says where the address leads. */
function Screen(props: ConsoleProps): ReactNode {
  const { route, project, sessions, unlisted, opening = { state: "idle" }, onOpen, onConfigured } = props;
  const listed = sessions ?? [];
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
    case "knowledge":
      return <KnowledgePage project={name} route={route} />;
    case "tests":
      return <TestsPage project={name} route={route} />;
    case "test":
      return <TestPage key={shown.path} project={name} path={shown.path} />;
    case "executions":
      return (
        <ExecutionsPage
          key={`${shown.outcome}:${shown.before}`}
          project={name}
          sessions={listed}
          {...(shown.outcome === undefined ? {} : { outcome: shown.outcome })}
          {...(shown.before === undefined ? {} : { before: shown.before })}
        />
      );
    case "execution":
      return <ExecutionPage key={shown.id} project={name} id={shown.id} sessions={listed} />;
    case "result":
      return (
        <ResultPage
          key={`${shown.id}:${shown.path}`}
          project={name}
          id={shown.id}
          path={shown.path}
          {...(shown.step === undefined ? {} : { step: shown.step })}
        />
      );
    case "opening":
    case "no_session":
    case "nowhere": {
      const words = NOTICES[shown.screen];
      const crumbs =
        shown.screen === "opening"
          ? [{ label: name }, { label: t("console.titles.entry"), href: hrefTo("/agent") }, { label: shown.id }]
          : [{ label: name }, { label: titleOf(shown.screen) }];
      return (
        <Page crumbs={crumbs} title={titleOf(shown.screen)}>
          <EmptyState title={t(`console.${words}.title`)} action={back}>
            {t(`console.${words}.body`)}
          </EmptyState>
        </Page>
      );
    }
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
