import type { ReactNode } from "react";
import type { Project } from "@open-qa-stack/domain/sessions";
import { hrefTo, type Route } from "../routing/route.ts";
import { t } from "../i18n/i18n.ts";
import { Icon } from "../ui/icon.tsx";
import { SidePanel } from "../ui/side-panel.tsx";
import { HOME_PATH } from "./navigation.ts";
import { NavigationList } from "./navigation-list.tsx";
import { NavigationTabs } from "./navigation-tabs.tsx";
import { isShortcutsOpen, withShortcuts } from "./shortcuts-help.ts";
import { ShortcutsList } from "./shortcuts-list.tsx";

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
  /** Whether the page takes the whole window, without the navigation, as a trace does. */
  readonly bare?: boolean;
  /** The page shown in the main area. */
  readonly children?: ReactNode;
}

/**
 * The frame of every screen: a band when the instance cannot be reached, the navigation and the page. On a phone a bar
 * at the top names the project beside the mark of the console, and on a screen of the navigation — not one under it,
 * which leads back to it — tabs at the bottom open the screens a person goes back to all day, and the screen that
 * lists the others. From a tablet the navigation is a menu at the left of the
 * page, under the mark: a button folds it to its icons, and one at its foot opens the help of the shortcuts, as `?`
 * does, in a panel its address keeps. A page that takes the whole window, as a trace does, has no navigation: it
 * leads back by itself. A project that has no name yet is not named.
 *
 * @param props - The route, the project and the page to frame.
 * @returns The shell.
 */
export function Shell({ route, project, unreachable = false, menu, bare = false, children }: ShellProps): ReactNode {
  const folded = menu?.folded === true;
  const brand = (
    <a className="brand" href={hrefTo(HOME_PATH)}>
      <i>✓</i>
      <span>Open QA Stack</span>
    </a>
  );
  const band = unreachable && (
    <div className="env" role="alert">
      ● {t("shell.offline")} <span className="n">{t("shell.offlineDetail")}</span>
    </div>
  );
  if (bare) {
    return (
      <div className="shell bare">
        {band}
        <main className="shell-page">{children}</main>
      </div>
    );
  }
  return (
    <div className={folded ? "shell folded" : "shell"}>
      {band}
      <header className="top">
        {brand}
        <span className="top-project">{project?.name}</span>
      </header>
      <aside id="shell-sidebar" className="shell-sidebar">
        <div className="side-head">
          {brand}
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
        </div>
        <NavigationList route={route} project={project} />
        <div className="side-foot">
          <a className="side-help" href={withShortcuts(route, true)} aria-haspopup="dialog" aria-keyshortcuts="?" title={t("shortcuts.title")}>
            <Icon name="help" />
            <span className="nav-label">{t("shortcuts.title")}</span>
          </a>
        </div>
      </aside>
      <main className="shell-page">{children}</main>
      {route.path.length <= 1 && <NavigationTabs route={route} />}
      {isShortcutsOpen(route) && (
        <SidePanel id="shell-shortcuts" title={t("shortcuts.title")} close={withShortcuts(route, false)}>
          <ShortcutsList />
        </SidePanel>
      )}
    </div>
  );
}
