import type { Words } from "../i18n/i18n.ts";
import type { IconName } from "../ui/icon.tsx";
import { hrefTo, isUnder, type Route } from "../routing/route.ts";

/** The path of the screen the home of the console opens: the entry of the agent. */
export const HOME_PATH = "/agent";

/** An entry of the navigation. */
export interface NavigationEntry {
  /** Its icon. */
  readonly icon: IconName;
  /** What it opens, which names its label in the resources. */
  readonly key: keyof Words["shell"]["entries"];
  /** The path of the screen it opens. */
  readonly path: string;
}

/** A group of entries of the navigation, under a heading. */
export interface NavigationGroup {
  /** What it holds, which names its heading in the resources. */
  readonly key: keyof Words["shell"]["groups"];
  /** Its entries. */
  readonly entries: readonly NavigationEntry[];
}

/**
 * The navigation of the console: the agents, which it shows at work, then the repository of tests and the
 * executions of its tests, and the knowledge and the configuration of the project.
 */
export const NAVIGATION: readonly NavigationGroup[] = [
  { key: "work", entries: [{ icon: "agent", key: "agent", path: "/agent" }] },
  {
    key: "repository",
    entries: [
      { icon: "discovery", key: "discovery", path: "/discovery" },
      { icon: "review", key: "review", path: "/review" },
      { icon: "tests", key: "tests", path: "/tests" },
    ],
  },
  {
    key: "execution",
    entries: [
      { icon: "play", key: "executions", path: "/executions" },
      { icon: "campaign", key: "campaigns", path: "/campaigns" },
      { icon: "warning", key: "defects", path: "/defects" },
    ],
  },
  {
    key: "project",
    entries: [
      { icon: "web", key: "applications", path: "/applications" },
      { icon: "layers", key: "knowledge", path: "/knowledge" },
      { icon: "memory", key: "memory", path: "/memory" },
      { icon: "settings", key: "configuration", path: "/configuration" },
    ],
  },
];

/**
 * Tells whether the console is at an entry of the navigation: under the screen it opens, or at the home for the
 * entry of the agent, which the home opens.
 *
 * @param route - Where the console is.
 * @param entry - The entry.
 * @returns Whether the entry is the one the console is at.
 */
export function isAt(route: Route, entry: NavigationEntry): boolean {
  return isUnder(route, entry.path) || (route.path.length === 0 && entry.path === HOME_PATH);
}

/**
 * Finds the entry of the navigation the console is at, which names the screen.
 *
 * @param route - Where the console is.
 * @returns The entry; none at an address that leads nowhere.
 */
export function entryAt(route: Route): NavigationEntry | undefined {
  return NAVIGATION.flatMap((group) => group.entries).find((entry) => isAt(route, entry));
}

/** The parameter of the query that opens the menu of a phone over the screen. */
const MENU = "nav";

/**
 * Tells whether the menu of a phone is open over the screen.
 *
 * @param route - Where the console is.
 * @returns Whether its address opens the menu.
 */
export function isMenuOpen(route: Route): boolean {
  return route.query[MENU] !== undefined;
}

/**
 * Writes the link to the screen of a route with the menu of a phone open over it, or closed.
 *
 * @param route - The route, whose other parameters are kept.
 * @param open - Whether the menu is open.
 * @returns The fragment to put in an `href`.
 */
export function withMenu(route: Route, open: boolean): string {
  const { [MENU]: _open, ...query } = route.query;
  return hrefTo(`/${route.path.join("/")}`, open ? { ...query, [MENU]: "open" } : query);
}
