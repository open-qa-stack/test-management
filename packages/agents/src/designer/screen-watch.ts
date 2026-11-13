import type { ToolDefinition } from "@open-qa-stack/domain";
import { scopedToolName, type SpecLocator } from "@open-qa-stack/tools";

/** The browser tools that change the page of an application. */
const ACTIONS = ["click", "fill", "select_option", "check"];
/** Most lines an action tells the agent appeared. */
const MAX_APPEARED = 60;
/** Most lines an action tells the agent went. */
const MAX_GONE = 20;

/** What the designer saw of the screens of one application. */
interface Seen {
  /** Every line a snapshot showed. */
  readonly lines: Set<string>;
  /** The lines shown before any action, since the page was last opened. */
  readonly before: Set<string>;
  /** The lines that appeared after an action. */
  readonly produced: Set<string>;
  /** The lines of the last snapshot of the whole page. */
  last: Set<string> | undefined;
  /** Whether an action was done since the page was last opened. */
  acted: boolean;
  /** Whether an action was ever done. */
  everActed: boolean;
}

/**
 * Watches what the designer does with the browser tools, so that a test relies on screens it saw.
 *
 * @remarks
 * The tools it gives are those it was given, with what the agent needs to see added to their results:
 * opening an address returns the snapshot of the page, and an action returns the lines of the snapshot that
 * appeared after it and those that went. A snapshot is given without what a test has no use for — the reference of each
 * element, the address of each link — so that a long session holds more screens. It remembers, for
 * each application, every line the snapshots showed, those shown before any action since the page was
 * opened, and those an action produced. An application without a user interface has no such tools, and is
 * held to nothing.
 */
export class ScreenWatch {
  private readonly seen = new Map<string, Seen>();
  private readonly watched: ToolDefinition[];

  /**
   * @param applications - Identifiers of the applications the browser tools may be of.
   * @param tools - The browser tools, named after their application.
   */
  public constructor(applications: readonly string[], tools: readonly ToolDefinition[]) {
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const owned = new Map<string, ToolDefinition>();
    for (const application of applications) {
      const snapshot = byName.get(scopedToolName(application, "snapshot"));
      if (snapshot === undefined) continue;
      const seen: Seen = { lines: new Set(), before: new Set(), produced: new Set(), last: undefined, acted: false, everActed: false };
      this.seen.set(application, seen);
      const read = async () => this.record(seen, compact((await snapshot.execute({})) as { page: string; truncated: boolean }), true);
      const wrap = (action: string, execute: (tool: ToolDefinition, args: unknown) => Promise<unknown>) => {
        const tool = byName.get(scopedToolName(application, action))!;
        owned.set(tool.name, { ...tool, execute: (args) => execute(tool, args) });
      };
      wrap("snapshot", async (tool, args) => {
        const result = compact((await tool.execute(args)) as { page: string; truncated: boolean });
        this.record(seen, result, (args as { within?: unknown }).within === undefined);
        return result;
      });
      wrap("goto", async (tool, args) => {
        const state = (await tool.execute(args)) as object;
        seen.acted = false;
        seen.before.clear();
        const shown = await read();
        return { ...state, page: shown.page, truncated: shown.truncated };
      });
      for (const action of ACTIONS) {
        wrap(action, async (tool, args) => {
          const previous = seen.last ?? (await read()).lines;
          const state = (await tool.execute(args)) as object;
          seen.acted = true;
          seen.everActed = true;
          const current = (await read()).lines;
          const appeared = absent(current, previous);
          for (const line of appeared) seen.produced.add(line);
          const told = appeared.length === 0 ? "Nothing new appeared on the page." : appeared.slice(0, MAX_APPEARED).join("\n");
          const gone = absent(previous, current);
          const more = gone.length > MAX_GONE ? [`${gone.length - MAX_GONE} more lines went.`] : [];
          return {
            ...state,
            appeared: told,
            ...(appeared.length > MAX_APPEARED ? { more: `${appeared.length - MAX_APPEARED} more lines appeared; take a snapshot to read them.` } : {}),
            gone: gone.length === 0 ? "Nothing went from the page." : [...gone.slice(0, MAX_GONE), ...more].join("\n"),
          };
        });
      }
    }
    this.watched = tools.map((tool) => owned.get(tool.name) ?? tool);
  }

  /**
   * The browser tools, watched.
   *
   * @returns The tools given, in their order.
   */
  public tools(): ToolDefinition[] {
    return [...this.watched];
  }

  /**
   * Why a test of an application may not be written yet.
   *
   * @param application - Identifier of the application.
   * @param acts - Whether the test is of a scenario that acts on the application, which the agent must have done itself.
   * @returns What the agent must do first with the browser tools; `undefined` when it did, or the application has no user interface.
   */
  public missing(application: string, acts: boolean): string | undefined {
    const seen = this.seen.get(application);
    if (seen === undefined) return undefined;
    const tool = (action: string) => scopedToolName(application, action);
    if (seen.lines.size === 0) return `You have not looked at the screens of ${application} yet. Open the page of the scenario with ${tool("goto")} and read what it shows before you write its test.`;
    if (acts && !seen.everActed) return `You have not done the steps of the scenario yourself yet. Do them with ${tool("fill")} and ${tool("click")}, read what appears, then write the test from what you saw.`;
    return undefined;
  }

  /**
   * The locators of a test that no screen of the application showed.
   *
   * @param application - Identifier of the application.
   * @param locators - The locators of the test, as its outline reads them.
   * @remarks
   * A screen shows a locator when one of its lines starts with the role, and one of its lines holds the name
   * or the text, whatever the case: the name of a row or a list is that of what it holds, on other lines.
   *
   * @returns Each such locator, once, as the test writes it; none for an application without a user interface.
   */
  public unseen(application: string, locators: readonly SpecLocator[]): string[] {
    const seen = this.seen.get(application);
    if (seen === undefined) return [];
    const lines = [...seen.lines];
    const shown = ({ role, text }: SpecLocator) =>
      (role === undefined || lines.some((line) => new RegExp(`^- '?${role}\\b`).test(line))) && (text === undefined || lines.some((line) => line.toLowerCase().includes(text.toLowerCase())));
    return [...new Set(locators.filter((locator) => !shown(locator)).map((locator) => locator.code))];
  }

  /**
   * Whether an assertion only names what the page showed before any action, and nothing an action
   * produced: such an assertion verifies no behaviour.
   *
   * @param application - Identifier of the application.
   * @param named - The texts the assertion names, as its outline reads them.
   * @returns `true` when every text it names was on the page before the action; `false` when it names none, or one that an action produced.
   */
  public shownBefore(application: string, named: readonly string[]): boolean {
    const seen = this.seen.get(application);
    const texts = named.map((text) => text.toLowerCase());
    if (seen === undefined || texts.length === 0) return false;
    const within = (lines: ReadonlySet<string>, text: string) => [...lines].some((line) => line.toLowerCase().includes(text));
    return texts.every((text) => within(seen.before, text) && !within(seen.produced, text));
  }

  /** Keeps what a snapshot showed; one of the whole page is the one the next action is compared with. */
  private record(seen: Seen, snapshot: { page: string; truncated: boolean }, whole: boolean): { page: string; truncated: boolean; lines: Set<string> } {
    const lines = new Set(snapshot.page.split("\n").map(normalized).filter((line) => line !== ""));
    for (const line of lines) {
      seen.lines.add(line);
      if (!seen.acted) seen.before.add(line);
    }
    if (whole) seen.last = lines;
    return { ...snapshot, lines };
  }
}

/** The lines of a snapshot that another does not show. */
function absent(lines: ReadonlySet<string>, other: ReadonlySet<string>): string[] {
  return [...lines].filter((line) => !other.has(line));
}

/** A line of a snapshot without its indentation. */
function normalized(line: string): string {
  return line.trim();
}

/** A snapshot without the reference of each element, which changes from one snapshot to the next, the mark of what can be clicked, nor the address of each link. */
function compact<T extends { page: string }>(snapshot: T): T {
  const lines = snapshot.page.split("\n").filter((line) => !/^\s*- \/url:/.test(line));
  return { ...snapshot, page: lines.map((line) => line.replace(/ \[(?:ref=[^\]]+|cursor=pointer)\]/g, "")).join("\n") };
}
