import type { ReactNode } from "react";
import type { Project } from "@open-qa-stack/domain/sessions";
import { hrefTo, isUnder, type Route } from "../routing/route.ts";
import { Icon } from "../ui/icon.tsx";
import { NAVIGATION, type NavigationEntry } from "./navigation.ts";

/** What the shell frames. */
export interface ShellProps {
  /** Where the console is, which tells the entry of the navigation to mark. */
  readonly route: Route;
  /** The project of the instance, once the API described it. */
  readonly project?: Project;
  /** Whether the instance could not be reached when last called. */
  readonly unreachable?: boolean;
  /** The page shown in the main area. */
  readonly children?: ReactNode;
}

/** An entry of the navigation: a link, marked when the console is under it, or the name of what is coming. */
function NavigationItem({ entry, route }: { readonly entry: NavigationEntry; readonly route: Route }): ReactNode {
  if (entry.path === undefined) {
    return (
      <span className="nav-soon">
        <Icon name={entry.icon} />
        <span className="nav-label">{entry.label}</span>
        <span className="soon">bientôt</span>
      </span>
    );
  }
  const active = route.path.length === 0 || isUnder(route, entry.path);
  return (
    <a href={hrefTo(entry.path)} className={active ? "on" : undefined} aria-current={active ? "page" : undefined}>
      <Icon name={entry.icon} />
      <span className="nav-label">{entry.label}</span>
    </a>
  );
}

/** How many applications a project has, in words. */
function applicationsOf(project: Project): string {
  const count = project.applications.length;
  return count === 1 ? "1 application" : `${count} applications`;
}

/**
 * The frame of every screen: a band when the instance cannot be reached, the top bar, the navigation — beside
 * the mark on a narrow screen, a sidebar on a wide one — and the page. A project that has no name yet is not named.
 *
 * @param props - The route, the project and the page to frame.
 * @returns The shell.
 */
export function Shell({ route, project, unreachable = false, children }: ShellProps): ReactNode {
  const name = project?.name;
  return (
    <div className="shell">
      {unreachable && (
        <div className="env" role="alert">
          ● Hors ligne <span className="n">— l’instance ne répond plus ; la page reprendra seule dès son retour</span>
        </div>
      )}
      <header className="top">
        <a className="brand" href={hrefTo("/agent")}>
          <i>✓</i>
          <span>Open QA Stack</span>
        </a>
        <div className="top-tools">
          {name !== undefined && (
            <span className="chip mono">
              <Icon name="git" /> {name}
            </span>
          )}
        </div>
      </header>
      <aside className="shell-sidebar">
        <nav className="nav" aria-label="Navigation principale">
          {project !== undefined && name !== undefined && (
            <div className="proj">
              <span className="proj-avatar">{name.slice(0, 2).toUpperCase()}</span>
              <b>
                {name}
                <small>{applicationsOf(project)} · projet</small>
              </b>
            </div>
          )}
          {NAVIGATION.map((group) => (
            <div key={group.label} className="nav-group">
              <div className="grp">{group.label}</div>
              {group.entries.map((entry) => (
                <NavigationItem key={entry.label} entry={entry} route={route} />
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <main className="shell-page">{children}</main>
    </div>
  );
}
