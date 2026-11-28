import type { Words } from "../i18n/i18n.ts";
import type { IconName } from "../ui/icon.tsx";
import { isUnder, type Route } from "../routing/route.ts";

/** The path of the screen the home of the console opens: the entry of the agent. */
export const HOME_PATH = "/agent";

/** An entry of the navigation. */
/** What the menu counts beside its entries: the tests that wait for a review, and those that failed last. */
export interface MenuCounts {
  readonly review: number;
  readonly tests: number;
}

/** How many things wait behind an entry, in the tone of what they are. */
export interface EntryCount {
  readonly value: number;
  readonly tone: "ai" | "ko";
}

/**
 * The count an entry of the navigation shows: the tests to review, in the tone of the agents, and those that failed, in the tone of the failure.
 *
 * @param key - The entry.
 * @param counts - What the menu counts, once the instance told it.
 * @returns Its count; none for an entry that counts nothing, or before the instance told.
 */
export function countOf(key: string, counts: MenuCounts | undefined): EntryCount | undefined {
  if (counts === undefined) return undefined;
  if (key === "review") return { value: counts.review, tone: "ai" };
  return key === "tests" ? { value: counts.tests, tone: "ko" } : undefined;
}

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

/** The path of the screen that lists, on a phone, the entries its tabs leave out. */
export const MORE_PATH = "/more";

/** The entries a phone keeps in its tabs: those a person goes back to all day. */
const TABBED: readonly NavigationEntry["key"][] = ["agent", "review", "tests", "executions"];

/** The tabs of a phone, in the order of the navigation, before the one that opens the other entries. */
export const TABS: readonly NavigationEntry[] = NAVIGATION.flatMap((group) => group.entries).filter((entry) => TABBED.includes(entry.key));

/** The entries the tabs of a phone leave out, under the heading of their group, as the screen of the others lists them. */
export const MORE: readonly NavigationGroup[] = NAVIGATION.map((group) => ({
  ...group,
  entries: group.entries.filter((entry) => !TABBED.includes(entry.key)),
})).filter((group) => group.entries.length > 0);

/**
 * Tells whether the tab that opens the other entries is the one a phone marks: on their screen, or under one of them.
 *
 * @param route - Where the console is.
 * @returns Whether the console is at the screen of the other entries, or at an entry no tab opens.
 */
export function isAtMore(route: Route): boolean {
  return isUnder(route, MORE_PATH) || MORE.some((group) => group.entries.some((entry) => isAt(route, entry)));
}
