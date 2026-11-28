import type { Words } from "../i18n/i18n.ts";
import { hrefTo, type Route } from "../routing/route.ts";

/** A key named in the language of the console: Escape, Enter, Shift or Control. */
export type NamedKey = keyof Words["shortcuts"]["keys"];

/** A key of a shortcut: one named in the language of the console, or one written as it is on a keyboard, such as `J` or `?`. */
export type ShortcutKey = NamedKey | { readonly sign: string };

/** A shortcut of the console: the keys pressed together, and what they do, which names its words. */
export interface ShortcutEntry {
  readonly keys: readonly ShortcutKey[];
  readonly does: keyof Words["shortcuts"]["does"];
}

/** The shortcuts of a part of the console, under its heading. */
export interface ShortcutGroup {
  readonly key: keyof Words["shortcuts"]["groups"];
  readonly entries: readonly ShortcutEntry[];
}

/** Every shortcut of the console, those of every screen first, then those of each screen that has some. */
export const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    key: "everywhere",
    entries: [
      { keys: [{ sign: "?" }], does: "help" },
      { keys: ["escape"], does: "close" },
    ],
  },
  {
    key: "agent",
    entries: [
      { keys: ["control", "enter"], does: "send" },
      { keys: ["enter"], does: "say" },
      { keys: ["shift", "enter"], does: "newLine" },
    ],
  },
  {
    key: "review",
    entries: [
      { keys: [{ sign: "J" }], does: "next" },
      { keys: [{ sign: "K" }], does: "previous" },
      { keys: [{ sign: "V" }], does: "validate" },
      { keys: [{ sign: "C" }], does: "correct" },
      { keys: [{ sign: "E" }], does: "setAside" },
    ],
  },
  { key: "test", entries: [{ keys: [{ sign: "R" }], does: "relaunch" }] },
  {
    key: "result",
    entries: [
      { keys: [{ sign: "←" }], does: "stepBefore" },
      { keys: [{ sign: "→" }], does: "stepAfter" },
    ],
  },
];

/** The parameter of the query that opens the help of the shortcuts over the screen. */
const KEYS = "keys";

/**
 * Tells whether the help of the shortcuts is open over the screen.
 *
 * @param route - Where the console is.
 * @returns Whether its address opens the help.
 */
export function isShortcutsOpen(route: Route): boolean {
  return route.query[KEYS] !== undefined;
}

/**
 * Writes the link to the screen of a route with the help of the shortcuts open over it, or closed.
 *
 * @param route - The route, whose other parameters are kept.
 * @param open - Whether the help is open.
 * @returns The fragment to put in an `href`.
 */
export function withShortcuts(route: Route, open: boolean): string {
  const { [KEYS]: _open, ...query } = route.query;
  return hrefTo(`/${route.path.join("/")}`, open ? { ...query, [KEYS]: "open" } : query);
}
