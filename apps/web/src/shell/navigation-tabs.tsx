import type { ReactNode } from "react";
import { hrefTo, type Route } from "../routing/route.ts";
import { t } from "../i18n/i18n.ts";
import { Icon } from "../ui/icon.tsx";
import { countOf, isAt, isAtMore, MORE_PATH, TABS, type MenuCounts } from "./navigation.ts";

/**
 * The tabs of a phone, at the bottom of the screen: the screens a person goes back to all day, then the one that lists
 * the others, each marked when the console is under it, with how many things wait behind it.
 *
 * @param props - Where the console is, and what the menu counts.
 * @returns The tabs.
 */
export function NavigationTabs({ route, counts }: { readonly route: Route; readonly counts?: MenuCounts | undefined }): ReactNode {
  const more = isAtMore(route);
  return (
    <nav className="tabs" aria-label={t("shell.tabs")}>
      {TABS.map((entry) => {
        const active = isAt(route, entry);
        const count = countOf(entry.key, counts);
        return (
          <a key={entry.key} href={hrefTo(entry.path)} className={active ? "on" : undefined} aria-current={active ? "page" : undefined}>
            <span className="tab-icon">
              <Icon name={entry.icon} />
              {count !== undefined && count.value > 0 && <span className={`nav-count ${count.tone}`}>{count.value}</span>}
            </span>
            <span className="tab-label">{t(`shell.entries.${entry.key}`)}</span>
          </a>
        );
      })}
      <a href={hrefTo(MORE_PATH)} className={more ? "on" : undefined} aria-current={more ? "page" : undefined}>
        <Icon name="more" />
        <span className="tab-label">{t("shell.more")}</span>
      </a>
    </nav>
  );
}
