/** The key the browser keeps whether the person folded the menu under. */
export const MENU_FOLD_KEY = "oqas.navigation";

/** What the browser keeps it as, once folded. */
const FOLDED = "folded";

/** The storage of the browser, or what stands for it; reaching it may throw, as in a private window. */
type Storage = () => Pick<globalThis.Storage, "getItem" | "setItem">;

/**
 * Whether the person left the menu folded, as the browser keeps it.
 *
 * @param storage - Reaches the storage of the browser.
 * @returns Whether it is folded; unfolded when the browser keeps nothing of it, or cannot be read.
 */
export function readMenuFold(storage: Storage): boolean {
  try {
    return storage().getItem(MENU_FOLD_KEY) === FOLDED;
  } catch {
    return false;
  }
}

/**
 * Keeps in the browser whether the person folded the menu, for the next visit; a browser that keeps nothing forgets it.
 *
 * @param storage - Reaches the storage of the browser.
 * @param folded - Whether the menu is folded.
 */
export function keepMenuFold(storage: Storage, folded: boolean): void {
  try {
    storage().setItem(MENU_FOLD_KEY, folded ? FOLDED : "unfolded");
  } catch {
    // The menu is folded or unfolded all the same, for this visit.
  }
}
