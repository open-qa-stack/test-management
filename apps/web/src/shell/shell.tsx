import type { ReactNode } from "react";
import type { Project } from "@open-qa-stack/domain/sessions";
import { hrefTo, isUnder, type Route } from "../routing/route.ts";
import { t } from "../i18n/i18n.ts";
import { Icon } from "../ui/icon.tsx";
import { HOME_PATH, NAVIGATION, type NavigationEntry } from "./navigation.ts";

/** The menu of a wide screen, which the person folds to its icons and unfolds. */
export interface ShellMenu {
  /** Whether it shows its icons alone. */
  readonly folded: boolean;
  /** Folds or unfolds it. */
  readonly toggle: () => void;
}

/** What the shell frames. */
export interface ShellProps {
  /** Where the console is, which tells the entry of the navigation to mark. */
  readonly route: Route;
  /** The project of the instance, once the API described it. */
  readonly project?: Project;
  /** Whether the instance could not be reached when last called. */
  readonly unreachable?: boolean;
  /** The menu of a wide screen, unfolded and without a way to fold it when none is given. */
  readonly menu?: ShellMenu;
  /** The page shown in the main area. */
  readonly children?: ReactNode;
}

/** An entry of the navigation: a link, marked when the console is under it, or the name of what is coming. */
function NavigationItem({ entry, route }: { readonly entry: NavigationEntry; readonly route: Route }): ReactNode {
  if (entry.path === undefined) {
    return (
      <span className="nav-soon">
        <Icon name={entry.icon} />
        <span className="nav-label">{t(`shell.entries.${entry.key}`)}</span>
        <span className="soon">{t("shell.soon")}</span>
      </span>
    );
  }
  // The home of the console is the entry of the agent.
  const active = isUnder(route, entry.path) || (route.path.length === 0 && entry.path === HOME_PATH);
  return (
    <a href={hrefTo(entry.path)} className={active ? "on" : undefined} aria-current={active ? "page" : undefined}>
      <Icon name={entry.icon} />
      <span className="nav-label">{t(`shell.entries.${entry.key}`)}</span>
    </a>
  );
}

/**
 * The frame of every screen: a band when the instance cannot be reached, the top bar, the navigation — beside
 * the mark on a narrow screen, a sidebar on a wide one, which a button of the bar folds to its icons — and the page.
 * A project that has no name yet is not named.
 *
 * @param props - The route, the project and the page to frame.
 * @returns The shell.
 */
export function Shell({ route, project, unreachable = false, menu, children }: ShellProps): ReactNode {
  const name = project?.name;
  const folded = menu?.folded === true;
  return (
    <div className={folded ? "shell folded" : "shell"}>
      {unreachable && (
        <div className="env" role="alert">
          ● {t("shell.offline")} <span className="n">{t("shell.offlineDetail")}</span>
        </div>
      )}
      <header className="top">
        {menu !== undefined && (
          <button
            type="button"
            className="menu-toggle"
            aria-controls="shell-sidebar"
            aria-expanded={!folded}
            aria-label={t(folded ? "shell.unfold" : "shell.fold")}
            title={t(folded ? "shell.unfold" : "shell.fold")}
            onClick={menu.toggle}
          >
            <Icon name="collapse" />
          </button>
        )}
        <a className="brand" href={hrefTo(HOME_PATH)}>
          <i>✓</i>
          <span>Open QA Stack</span>
        </a>
      </header>
      <aside id="shell-sidebar" className="shell-sidebar">
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
      </aside>
      <main className="shell-page">{children}</main>
    </div>
  );
}
