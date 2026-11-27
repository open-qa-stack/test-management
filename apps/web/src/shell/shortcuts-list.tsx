import type { ReactNode } from "react";
import { t } from "../i18n/i18n.ts";
import { SHORTCUTS, type ShortcutKey } from "./shortcuts-help.ts";

/** How a key is written: its name in the language of the console, or its sign. */
function written(key: ShortcutKey): string {
  return typeof key === "string" ? t(`shortcuts.keys.${key}`) : key.sign;
}

/**
 * The shortcuts of the console, by the part of it they are for: the keys of each, and what it does.
 *
 * @returns The list.
 */
export function ShortcutsList(): ReactNode {
  return SHORTCUTS.map(({ key, entries }) => (
    <section key={key} className="shortcuts-group" aria-labelledby={`shortcuts-${key}`}>
      <h3 id={`shortcuts-${key}`}>{t(`shortcuts.groups.${key}`)}</h3>
      <dl className="shortcuts">
        {entries.map(({ keys, does }) => (
          <div key={does} className="shortcut">
            <dt>
              {keys.map((key) => (
                <kbd key={written(key)}>{written(key)}</kbd>
              ))}
            </dt>
            <dd>{t(`shortcuts.does.${does}`)}</dd>
          </div>
        ))}
      </dl>
    </section>
  ));
}
