import type { ReactNode } from "react";
import type { Project } from "@open-qa-stack/domain/sessions";
import type { Route } from "../routing/route.ts";
import { t } from "../i18n/i18n.ts";
import { NAVIGATION } from "./navigation.ts";
import { NavigationItem } from "./navigation-item.tsx";

/** What the navigation is drawn from. */
export interface NavigationListProps {
  /** Where the console is, which tells the entry to mark. */
  readonly route: Route;
  /** The project of the instance, once the API described it. */
  readonly project?: Project | undefined;
}

/**
 * The navigation: the project, once it has a name, over the entries of each group under its heading.
 *
 * @param props - Where the console is and the project.
 * @returns The navigation.
 */
export function NavigationList({ route, project }: NavigationListProps): ReactNode {
  const name = project?.name;
  return (
    <nav className="nav" aria-label={t("shell.navigation")}>
      {project !== undefined && name !== undefined && (
        <div className="proj">
          <span className="proj-avatar">{name.slice(0, 2).toUpperCase()}</span>
          <b>
            {name}
            <small>{t("shell.applications", { count: project.applications.length })}</small>
          </b>
        </div>
      )}
      {NAVIGATION.map((group) => (
        <div key={group.key} className="nav-group">
          <div className="grp">{t(`shell.groups.${group.key}`)}</div>
          {group.entries.map((entry) => (
            <NavigationItem key={entry.key} entry={entry} route={route} />
          ))}
        </div>
      ))}
    </nav>
  );
}
