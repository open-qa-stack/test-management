import type { ReactNode } from "react";
import { hrefTo, type Route } from "../routing/route.ts";
import { t } from "../i18n/i18n.ts";
import { Icon } from "../ui/icon.tsx";
import { isAt, type NavigationEntry } from "./navigation.ts";

/** What an entry of the navigation is drawn from. */
export interface NavigationItemProps {
  /** The entry. */
  readonly entry: NavigationEntry;
  /** Where the console is, which tells whether the entry is marked. */
  readonly route: Route;
}

/**
 * An entry of the navigation: a link, marked when the console is under it.
 *
 * @param props - The entry and where the console is.
 * @returns The entry.
 */
export function NavigationItem({ entry, route }: NavigationItemProps): ReactNode {
  const active = isAt(route, entry);
  return (
    <a href={hrefTo(entry.path)} className={active ? "on" : undefined} aria-current={active ? "page" : undefined}>
      <Icon name={entry.icon} />
      <span className="nav-label">{t(`shell.entries.${entry.key}`)}</span>
    </a>
  );
}
