import type { ReactNode } from "react";
import type { Project } from "@open-qa-stack/domain/sessions";
import { hrefTo, type Route } from "../routing/route.ts";
import { t } from "../i18n/i18n.ts";
import { Icon } from "../ui/icon.tsx";
import { SidePanel } from "../ui/side-panel.tsx";
import { entryAt, HOME_PATH, isMenuOpen, withMenu } from "./navigation.ts";
import { NavigationList } from "./navigation-list.tsx";
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
  /** The page shown in the main area. */
  readonly children?: ReactNode;
}

/**
 * The frame of every screen: a band when the instance cannot be reached, the top bar, the navigation and the page.
 * On a phone the bar names the screen beside a button that opens the navigation over it, in a panel its address
 * keeps; beside the mark on a tablet, a sidebar on a wide screen, which a button of the bar folds to its icons. From a
 * tablet, a button of the bar opens the help of the shortcuts, as `?` does, in a panel its address keeps.
 * A project that has no name yet is not named.
 *
 * @param props - The route, the project and the page to frame.
 * @returns The shell.
 */
export function Shell({ route, project, unreachable = false, menu, children }: ShellProps): ReactNode {
  const screen = entryAt(route);
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
        <span className="top-screen">{screen === undefined ? "Open QA Stack" : t(`shell.entries.${screen.key}`)}</span>
        <a className="btn top-menu" href={withMenu(route, true)} aria-haspopup="dialog">
          {t("shell.menuTitle")}
        </a>
        <a
          className="top-help"
          href={withShortcuts(route, true)}
          aria-haspopup="dialog"
          aria-keyshortcuts="?"
          aria-label={t("shortcuts.title")}
          title={t("shortcuts.title")}
        >
          <Icon name="help" />
        </a>
      </header>
      <aside id="shell-sidebar" className="shell-sidebar">
        <NavigationList route={route} project={project} />
      </aside>
      <main className="shell-page">{children}</main>
      {isMenuOpen(route) && (
        <SidePanel id="shell-menu" title={t("shell.menuTitle")} close={withMenu(route, false)}>
          <NavigationList route={route} project={project} />
        </SidePanel>
      )}
      {isShortcutsOpen(route) && (
        <SidePanel id="shell-shortcuts" title={t("shortcuts.title")} close={withShortcuts(route, false)}>
          <ShortcutsList />
        </SidePanel>
      )}
    </div>
  );
}
