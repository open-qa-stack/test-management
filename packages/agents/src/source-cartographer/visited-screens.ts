import type { AgentEvent } from "@open-qa-stack/domain";
import { fingerprintOf, scopedToolName, type SourceInventory } from "@open-qa-stack/tools";

/** A link line of a snapshot: `- /url: /customers`, the address quoted when YAML needs it. */
const LINK = /^\s*- \/url: (.+)$/;

/**
 * The screens of a user interface the agent has visited, read from what its browser tools answered.
 *
 * @remarks
 * A screen is named by its path on the user interface, with the route after `#/` of an application that
 * routes in the fragment, and without its query: `/customers`, `/#/policies`. Addresses of other sites are
 * no screens. The elements are the screens visited, in the order of the first visit; the facts of each are
 * its latest title and the other screens its snapshots link to. The fingerprint covers both.
 *
 * @param events - The events of the session so far.
 * @param applicationId - Identifier of the application, which names its tools.
 * @param uiUrl - Address of its user interface.
 * @returns The inventory of the screens visited.
 */
export function visitedScreens(events: readonly AgentEvent[], applicationId: string, uiUrl: string): SourceInventory {
  const prefix = scopedToolName(applicationId, "");
  const base = new URL(uiUrl);
  const screens = new Map<string, { title: string; links: Set<string> }>();
  for (const event of events) {
    if (event.type !== "tool-result" || !event.tool.startsWith(prefix) || !isPageState(event.result)) continue;
    const { url, title, page } = event.result;
    const screen = screenOf(url, base, base);
    if (screen === undefined) continue;
    const known = screens.get(screen) ?? { title, links: new Set<string>() };
    known.title = title;
    for (const line of (page ?? "").split("\n")) {
      const link = LINK.exec(line)?.[1];
      const target = link === undefined ? undefined : screenOf(unquoted(link), new URL(url, base), base);
      if (target !== undefined && target !== screen) known.links.add(target);
    }
    screens.set(screen, known);
  }
  const items = [...screens.keys()];
  const facts = new Map(items.map((item) => [item, { title: screens.get(item)!.title, links: [...screens.get(item)!.links].sort() }]));
  return { items, facts, fingerprint: fingerprintOf(JSON.stringify([...facts])) };
}

/** Whether a tool result tells where a page is: an address, a title and, for a snapshot, the page. */
function isPageState(result: unknown): result is { url: string; title: string; page?: string } {
  const value = result as { url?: unknown; title?: unknown; page?: unknown } | null;
  return typeof value?.url === "string" && typeof value.title === "string" && (value.page === undefined || typeof value.page === "string");
}

/** The screen an address leads to, resolved against `from`, when it is on the user interface. */
function screenOf(address: string, from: URL, base: URL): string | undefined {
  const url = URL.canParse(address, from.href) ? new URL(address, from) : undefined;
  if (url?.origin !== base.origin) return undefined;
  return `${url.pathname}${url.hash.startsWith("#/") ? url.hash.split("?")[0] : ""}`;
}

/** A YAML scalar without its quotes. */
function unquoted(text: string): string {
  return /^(["']).*\1$/.test(text) ? text.slice(1, -1) : text;
}
