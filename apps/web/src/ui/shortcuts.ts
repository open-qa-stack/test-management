/** What each key does, by its name: `ArrowLeft`, a letter in lower case, or a sign such as `?`. */
export type Shortcuts = Readonly<Record<string, () => void>>;

/** Where a key is for what holds the focus: a field, or a dialog over the page. */
const OWN_KEYS = "input, textarea, select, [contenteditable], dialog";

/**
 * Hears the keys a person presses on a page, and does what each is a shortcut of: not while they type or a dialog is
 * over the page, not with a modifier, which the browser has its own use for, and once for a key held down. Shift is
 * no modifier of a sign, such as `?`, which many keyboards type with it.
 *
 * @param page - The document of the page.
 * @param shortcuts - What each key does.
 * @returns What stops hearing them.
 */
export function hearShortcuts(page: Document, shortcuts: Shortcuts): () => void {
  const hear = (event: KeyboardEvent): void => {
    const { key, altKey, ctrlKey, metaKey, shiftKey, repeat, target } = event;
    const signed = key.length === 1 && !/[\p{L}\p{N}]/u.test(key);
    if (event.defaultPrevented || repeat || altKey || ctrlKey || metaKey || (shiftKey && !signed)) return;
    const name = key.length === 1 ? key.toLowerCase() : key;
    if (!Object.hasOwn(shortcuts, name)) return;
    if ((target as Element).closest(OWN_KEYS) !== null || page.querySelector("dialog[open]") !== null) return;
    event.preventDefault();
    shortcuts[name]!();
  };
  page.addEventListener("keydown", hear);
  return () => page.removeEventListener("keydown", hear);
}
