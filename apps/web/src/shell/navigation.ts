import type { Words } from "../i18n/i18n.ts";
import type { IconName } from "../ui/icon.tsx";

/** The path of the screen the home of the console opens: the entry of the agent. */
export const HOME_PATH = "/agent";

/** An entry of the navigation. */
export interface NavigationEntry {
  /** Its icon. */
  readonly icon: IconName;
  /** What it opens, which names its label in the resources. */
  readonly key: keyof Words["shell"]["entries"];
  /** The path of the screen it opens; none for a part of the console that does not exist yet. */
  readonly path?: string;
}

/** A group of entries of the navigation, under a heading. */
export interface NavigationGroup {
  /** What it holds, which names its heading in the resources. */
  readonly key: keyof Words["shell"]["groups"];
  /** Its entries. */
  readonly entries: readonly NavigationEntry[];
}

/**
 * The navigation of the console: the agents, which it shows at work, then what it will show of the repository
 * of tests and of their runs, named so that a person sees what is coming, and the knowledge and the configuration of
 * the project.
 */
export const NAVIGATION: readonly NavigationGroup[] = [
  { key: "work", entries: [{ icon: "agent", key: "agent", path: "/agent" }] },
  {
    key: "repository",
    entries: [
      { icon: "discovery", key: "discovery" },
      { icon: "review", key: "review" },
      { icon: "tests", key: "tests", path: "/tests" },
      { icon: "check", key: "coverage" },
    ],
  },
  {
    key: "execution",
    entries: [
      { icon: "campaign", key: "campaigns" },
      { icon: "warning", key: "defects" },
    ],
  },
  {
    key: "project",
    entries: [
      { icon: "layers", key: "knowledge", path: "/knowledge" },
      { icon: "settings", key: "configuration", path: "/configuration" },
    ],
  },
];
