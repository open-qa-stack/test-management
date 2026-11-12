import type { Page } from "playwright-core";
import { recommendTarget, type Recommendation } from "./recommended-target.ts";
import { shortText } from "./short-text.ts";
import { targetCode } from "./target.ts";

/** Longest snapshot text returned, in characters; the rest of the page is cut at a line. */
export const MAX_SNAPSHOT_LENGTH = 12_000;
/** Most elements given a recommended locator in one snapshot. */
export const MAX_ANNOTATED_ELEMENTS = 150;

/** Roles of the elements an agent acts on; any element the page shows as clickable is one too. */
const INTERACTIVE_ROLES = new Set([
  "button", "checkbox", "combobox", "link", "listbox", "menuitem", "menuitemcheckbox", "menuitemradio", "option",
  "radio", "searchbox", "slider", "spinbutton", "switch", "tab", "textbox", "treeitem",
]);

/** An element line: indentation, then the role, then the quoted name, the whole line quoted when YAML needs it. */
const ELEMENT = /^(\s*)- ('?)([a-z]+)(?: "((?:[^"\\]|\\.)*)")?/;
const REF = /\[ref=([^\]]+)\]/;

/** What a page shows, as the agent reads it. */
export interface PageSnapshot {
  /** Address of the page. */
  readonly url: string;
  /** Title of the page. */
  readonly title: string;
  /**
   * The accessibility tree of the page, one element per line. Each element an agent can act on ends with
   * `→` and the Playwright locator a test should use for it, or the reason there is none.
   */
  readonly page: string;
  /** Whether the tree was cut to `MAX_SNAPSHOT_LENGTH`, or some elements left without a locator. */
  readonly truncated: boolean;
}

/** An element of a snapshot line. */
interface SnapshotElement {
  readonly indent: number;
  readonly role: string;
  readonly name: string;
  readonly ref: string | undefined;
  readonly clickable: boolean;
}

/**
 * Takes a snapshot of a page: its accessibility tree, with the recommended locator of each element an
 * agent can act on.
 *
 * @remarks
 * Elements inside a frame are shown, but marked as out of reach: the locators of the tools search the
 * page itself.
 *
 * @param page - The page.
 * @returns The snapshot.
 * @throws Error when the page cannot be read, for instance while it navigates.
 */
export async function pageSnapshot(page: Page): Promise<PageSnapshot> {
  const tree = await page.ariaSnapshot({ mode: "ai" });
  const lines: string[] = [];
  let annotated = 0;
  let truncated = false;
  let frameIndent: number | undefined;
  for (const line of tree.split("\n")) {
    const element = snapshotElement(line);
    if (frameIndent !== undefined && element !== undefined && element.indent <= frameIndent) frameIndent = undefined;
    if (element === undefined || element.ref === undefined || !(INTERACTIVE_ROLES.has(element.role) || element.clickable)) {
      lines.push(line);
    } else if (frameIndent !== undefined) {
      lines.push(`${line} → inside a frame: these tools cannot reach it`);
    } else if (annotated === MAX_ANNOTATED_ELEMENTS) {
      lines.push(line);
      truncated = true;
    } else {
      annotated++;
      lines.push(`${line} → ${describe(await recommendTarget(page, element.ref, element.role, element.name))}`);
    }
    if (element?.role === "iframe" && frameIndent === undefined) frameIndent = element.indent;
  }
  const text = cut(lines);
  return { url: shortText(page.url()), title: shortText(await page.title()), page: text, truncated: truncated || text.length < lines.join("\n").length };
}

function snapshotElement(line: string): SnapshotElement | undefined {
  const match = ELEMENT.exec(line);
  if (match === null) return undefined;
  const [, indent, quoted, role, escaped] = match as unknown as [string, string, string, string, string | undefined];
  const name = escaped === undefined ? "" : (JSON.parse(`"${quoted === "" ? escaped : escaped.replaceAll("''", "'")}"`) as string);
  return { indent: indent.length, role, name, ref: REF.exec(line)?.[1], clickable: line.includes("[cursor=pointer]") };
}

function describe(recommendation: Recommendation): string {
  switch (recommendation.kind) {
    case "unique":
      return targetCode(recommendation.target);
    case "ambiguous":
      return `no unique locator: ${recommendation.matches} elements match ${targetCode(recommendation.target)}`;
    case "none":
      return "no locator by role, label, test id or text";
    case "changed":
      return "the element changed while the snapshot was taken; take another one";
  }
}

/** The lines, as many whole ones as fit in `MAX_SNAPSHOT_LENGTH`. */
function cut(lines: readonly string[]): string {
  let length = 0;
  const kept: string[] = [];
  for (const line of lines) {
    length += line.length + 1;
    if (length > MAX_SNAPSHOT_LENGTH + 1) break;
    kept.push(line);
  }
  return kept.join("\n");
}
