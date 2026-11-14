import type { TargetScope } from "./target.ts";

/** What `readScope` reads of an element and its ancestors; the package is typed without the DOM library. */
export interface ScopeElement {
  /** The name of its tag, in upper case. */
  readonly tagName: string;
  /** The value of an attribute, or `null`. */
  getAttribute(name: string): string | null;
  /** Its parent, `null` at the top. */
  readonly parentElement: ScopeElement | null;
  /** Its child elements. */
  readonly children: ArrayLike<ScopeElement>;
  /** The text of the element and its descendants. */
  readonly textContent: string | null;
}

/**
 * Reads the part of the page that holds an element, for an element that repeats from one part to the next,
 * such as a button on each row: the closest row or dialog around it. A row is named by the text of its
 * first child that has one, such as its first cell, which is a part of its accessible name. Runs in the
 * page, so it holds everything it uses.
 *
 * @param element - The element.
 * @returns The part, by role and name; `null` when no such part holds it.
 */
export function readScope(element: ScopeElement): TargetScope | null {
  const implicit: Readonly<Record<string, string>> = { TR: "row", DIALOG: "dialog" };
  for (let part = element.parentElement; part !== null; part = part.parentElement) {
    const role = part.getAttribute("role") ?? implicit[part.tagName];
    if (role !== "row" && role !== "dialog") continue;
    if (role === "dialog") return { role };
    for (const child of Array.from(part.children)) {
      const name = (child.textContent ?? "").replace(/\s+/g, " ").trim();
      if (name !== "") return { role, name };
    }
    return { role };
  }
  return null;
}
