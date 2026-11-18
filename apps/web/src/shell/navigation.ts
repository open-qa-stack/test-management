import type { IconName } from "../ui/icon.tsx";

/** The path of the screen the home of the console opens: the entry of the agent. */
export const HOME_PATH = "/agent";

/** An entry of the navigation. */
export interface NavigationEntry {
  /** Its icon. */
  readonly icon: IconName;
  /** Its label. */
  readonly label: string;
  /** The path of the screen it opens; none for a part of the console that does not exist yet. */
  readonly path?: string;
}

/** A group of entries of the navigation, under a heading. */
export interface NavigationGroup {
  /** Its heading. */
  readonly label: string;
  /** Its entries. */
  readonly entries: readonly NavigationEntry[];
}

/**
 * The navigation of the console: the agents, which it shows at work, then what it will show of the repository
 * of tests and of their runs, named so that a person sees what is coming, and the configuration of the project.
 */
export const NAVIGATION: readonly NavigationGroup[] = [
  { label: "Travail", entries: [{ icon: "agent", label: "Agent", path: "/agent" }] },
  {
    label: "Référentiel",
    entries: [
      { icon: "discovery", label: "Découverte" },
      { icon: "review", label: "À relire" },
      { icon: "tests", label: "Tests" },
      { icon: "check", label: "Couverture" },
    ],
  },
  {
    label: "Exécution",
    entries: [
      { icon: "campaign", label: "Campagnes" },
      { icon: "warning", label: "Anomalies" },
    ],
  },
  { label: "Projet", entries: [{ icon: "settings", label: "Configuration", path: "/configuration" }] },
];
