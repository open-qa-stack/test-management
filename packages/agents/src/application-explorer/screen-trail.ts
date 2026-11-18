import type { ToolDefinition } from "@open-qa-stack/domain";
import { changingName, destructiveName, scopedToolName, type Target } from "@open-qa-stack/tools";
import { observed } from "../designer/observed.ts";

/** A link line of a snapshot: `- /url: /customers`, the address quoted when YAML needs it. */
const LINK = /^\s*- \/url: (.+)$/;
/** A segment of a path that names one record: a number, a UUID, or six characters or more with a digit. */
const RECORD = /^(?:\d+|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{6,})$/i;
/** The tools that act on the page, after which the trail reads what it shows. */
const ACTIONS = ["goto", "click", "fill", "select_option", "check"];

/** What an exploration may do in an environment: change no data, or submit the forms that create or change some. */
export type ExplorationMode = "read-only" | "read-write";

/** A screen an exploration opened: what it last showed, and where it leads. */
export interface VisitedScreen {
  /** Its route, the same for every record it shows: `/customers/:id`. */
  readonly route: string;
  /** Its latest title. */
  readonly title: string;
  /** What it last showed, as its snapshot gives it. */
  readonly page: string;
  /** The other screens its snapshots link to, by their routes. */
  readonly links: readonly string[];
}

/**
 * The route of the screen an address leads to, when it is on the user interface.
 *
 * @remarks
 * A screen is named by its path, with the route after `#/` of an application that routes in the fragment,
 * and without its query. A segment that names one record — a number, a UUID, six characters or more with a
 * digit — is written `:id`, so that the screen of every record is one screen: `/customers/:id`.
 *
 * @param address - The address, absolute or relative to `from`.
 * @param from - The address it is read on.
 * @param base - The address of the user interface.
 * @returns The route; `undefined` for an address of another site, or one that cannot be read.
 */
export function screenRoute(address: string, from: URL, base: URL): string | undefined {
  const url = URL.canParse(address, from.href) ? new URL(address, from) : undefined;
  if (url?.origin !== base.origin) return undefined;
  const path = `${url.pathname}${url.hash.startsWith("#/") ? url.hash.split("?")[0] : ""}`;
  return path
    .split("/")
    .map((segment) => (RECORD.test(segment) ? ":id" : segment))
    .join("/");
}

/**
 * What an agent saw of a user interface while it explored it, as the calls of its browser tools tell, and
 * what it may do there.
 *
 * @remarks
 * The harness holds a map to what the agent opened, not to what it says. After each action on the page the
 * trail reads what the page shows, and gives it back with the result of the action, so that the agent sees
 * where each step leads without asking. Each result names a screen by its route; the trail keeps what the
 * screen last showed, every line it ever showed, and the screens its links lead to. A link seen and never
 * opened is a screen still to visit.
 *
 * An exploration never removes data: an element whose name says it removes some is not clicked. In an
 * environment explored `read-only`, one whose name says it creates or changes data is not clicked either:
 * the agent reads the form, and goes on. Both are guesses from words, as `destructiveName` is.
 */
export class ScreenTrail {
  private readonly applicationId: string;
  private readonly base: URL;
  private readonly mode: ExplorationMode;
  private readonly screens = new Map<string, { title: string; page: string; lines: Set<string>; links: Set<string> }>();
  private readonly seen = new Set<string>();

  /**
   * @param applicationId - Identifier of the application, which names its tools.
   * @param uiUrl - Address of its user interface.
   * @param mode - What the exploration may do in this environment.
   */
  public constructor(applicationId: string, uiUrl: string, mode: ExplorationMode) {
    this.applicationId = applicationId;
    this.base = new URL(uiUrl);
    this.mode = mode;
  }

  /**
   * The browser tools of the application, watched and guarded.
   *
   * @param tools - The browser tools of the application.
   * @returns The same tools: an action gives back what the page then shows, and a click that would remove
   * data, or change some in an environment explored `read-only`, is refused.
   */
  public watched(tools: readonly ToolDefinition[]): ToolDefinition[] {
    const snapshot = tools.find((tool) => tool.name === scopedToolName(this.applicationId, "snapshot"))!;
    return tools.map((tool) => {
      const action = ACTIONS.find((name) => tool.name === scopedToolName(this.applicationId, name));
      if (action === undefined) return { ...tool, execute: async (args) => this.recorded(await tool.execute(args)) };
      return {
        ...tool,
        execute: async (args) => {
          const refusal = action === "click" ? this.refusal((args as { target: Target }).target) : undefined;
          if (refusal !== undefined) return { error: refusal };
          const { confirm: _confirm, ...given } = args as Record<string, unknown>;
          const done = await tool.execute(given);
          if (typeof done !== "object" || done === null || "error" in done) return done;
          const shown = this.recorded(await snapshot.execute({})) as { page?: string; truncated?: boolean };
          return { ...done, page: shown.page, ...(shown.truncated === true ? { truncated: true } : {}) };
        },
      };
    });
  }

  /**
   * The screens the agent opened.
   *
   * @returns Them, in the order of the first visit.
   */
  public get visited(): VisitedScreen[] {
    return [...this.screens].map(([route, { title, page, links }]) => ({ route, title, page, links: [...links].sort((a, b) => a.localeCompare(b)) }));
  }

  /**
   * The screens a link led to that the agent never opened.
   *
   * @returns Their routes, in the order the links were seen.
   */
  public get pending(): string[] {
    return [...this.seen].filter((route) => !this.screens.has(route));
  }

  /**
   * The route an agent means by what it wrote: a route of the trail as it is, whatever name it gives a
   * record, or the route of an address.
   *
   * @param written - A route, a path or an address.
   * @returns The route of a screen visited or seen; `undefined` when the trail knows none such.
   */
  public route(written: string): string | undefined {
    // A record is `:id` whatever the agent calls it: /customers/:customerId is /customers/:id.
    const named = written.replace(/(?<=\/):[A-Za-z_][A-Za-z0-9_]*/g, ":id");
    const route = this.known(named) ? named : screenRoute(named, this.base, this.base);
    return route !== undefined && this.known(route) ? route : undefined;
  }

  /**
   * Whether a screen showed a text, spaces and case aside, at any time of the exploration.
   *
   * @param route - Route of the screen.
   * @param text - The text.
   * @returns `true` when a line of one of its snapshots holds it.
   */
  public shows(route: string, text: string): boolean {
    return observed(text, this.screens.get(route)?.lines ?? []);
  }

  private known(route: string): boolean {
    return this.screens.has(route) || this.seen.has(route);
  }

  /** Why an element is not clicked in this exploration; nothing when it may be. */
  private refusal(target: Target): string | undefined {
    const removing = destructiveName(target);
    if (removing !== undefined)
      return `Nothing was clicked: "${removing}" may remove data of the application, and an exploration never removes any. Note that the screen offers it, and go on.`;
    const changing = this.mode === "read-only" ? changingName(target) : undefined;
    return changing === undefined
      ? undefined
      : `Nothing was clicked: "${changing}" may create or change data, and this environment is explored without changing any. Read what the form asks — its fields, what is required, the rules the page states — note it, and go on.`;
  }

  /** Keeps what a result tells of the screen the page is on, and gives the result back. */
  private recorded(result: unknown): unknown {
    const { url, title, page } = (result ?? {}) as { url?: unknown; title?: unknown; page?: unknown };
    if (typeof url !== "string" || typeof title !== "string") return result;
    const route = screenRoute(url, this.base, this.base);
    if (route === undefined) return result;
    const screen = this.screens.get(route) ?? { title, page: "", lines: new Set<string>(), links: new Set<string>() };
    screen.title = title;
    if (typeof page === "string") {
      screen.page = page;
      for (const line of page.split("\n")) {
        const link = LINK.exec(line)?.[1];
        const target = link === undefined ? undefined : screenRoute(link.replace(/^(["'])(.*)\1$/, "$2"), new URL(url, this.base), this.base);
        if (link === undefined) screen.lines.add(line);
        else if (target !== undefined && target !== route) screen.links.add(target);
      }
      for (const target of screen.links) this.seen.add(target);
    }
    this.screens.set(route, screen);
    return result;
  }
}
