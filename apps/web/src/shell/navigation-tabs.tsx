import type { ReactNode } from "react";
import { hrefTo, type Route } from "../routing/route.ts";
import { t } from "../i18n/i18n.ts";
import { Icon } from "../ui/icon.tsx";
import { isAt, isAtMore, MORE_PATH, TABS } from "./navigation.ts";

/**
 * The tabs of a phone, at the bottom of the screen: the screens a person goes back to all day, then the one that lists
 * the others, each marked when the console is under it.
 *
 * @param props - Where the console is.
 * @returns The tabs.
 */
export function NavigationTabs({ route }: { readonly route: Route }): ReactNode {
  const more = isAtMore(route);
  return (
    <nav className="tabs" aria-label={t("shell.tabs")}>
      {TABS.map((entry) => {
        const active = isAt(route, entry);
        return (
          <a key={entry.key} href={hrefTo(entry.path)} className={active ? "on" : undefined} aria-current={active ? "page" : undefined}>
            <Icon name={entry.icon} />
            <span>{t(`shell.entries.${entry.key}`)}</span>
          </a>
        );
      })}
      <a href={hrefTo(MORE_PATH)} className={more ? "on" : undefined} aria-current={more ? "page" : undefined}>
        <Icon name="more" />
        <span>{t("shell.more")}</span>
      </a>
    </nav>
  );
}
