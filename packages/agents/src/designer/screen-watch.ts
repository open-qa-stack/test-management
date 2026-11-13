import type { ToolDefinition } from "@open-qa-stack/domain";
import { scopedToolName } from "@open-qa-stack/tools";
import { namedTexts, usedLocators, type UsedLocator } from "./test-locators.ts";

/** The browser tools that change the page of an application. */
const ACTIONS = ["click", "fill", "select_option", "check"];
/** Most lines an action tells the agent appeared. */
const MAX_APPEARED = 60;

/** What the designer saw of the screens of one application. */
interface Seen {
  /** Every line a snapshot showed. */
  readonly lines: Set<string>;
  /** The lines shown before any action, since the page was last opened. */
  readonly before: Set<string>;
  /** The lines that appeared after an action. */
  readonly produced: Set<string>;
  /** The lines of the last snapshot. */
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
 * appeared after it. It remembers, for
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
      const read = async () => this.record(seen, (await snapshot.execute({})) as { page: string; truncated: boolean });
      const wrap = (action: string, execute: (tool: ToolDefinition, args: unknown) => Promise<unknown>) => {
        const tool = byName.get(scopedToolName(application, action))!;
        owned.set(tool.name, { ...tool, execute: (args) => execute(tool, args) });
      };
      wrap("snapshot", async (tool, args) => {
        const result = (await tool.execute(args)) as { page: string; truncated: boolean };
        this.record(seen, result);
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
          const appeared = this.appeared(previous, (await read()).lines);
          for (const line of appeared) seen.produced.add(line);
          const told = appeared.length === 0 ? "Nothing new appeared on the page." : appeared.slice(0, MAX_APPEARED).join("\n");
          return { ...state, appeared: told, ...(appeared.length > MAX_APPEARED ? { more: `${appeared.length - MAX_APPEARED} more lines appeared; take a snapshot to read them.` } : {}) };
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
   * @param content - Text of the test.
   * @returns Each such locator, once, as the test writes it; none for an application without a user interface.
   */
  public unseen(application: string, content: string): string[] {
    const seen = this.seen.get(application);
    if (seen === undefined) return [];
    const lines = [...seen.lines];
    return [...new Set(usedLocators(content).filter((locator) => !lines.some((line) => shows(line, locator))).map((locator) => locator.code))];
  }

  /**
   * Whether an assertion only names what the page showed before any action, and nothing an action
   * produced: such an assertion verifies no behaviour.
   *
   * @param application - Identifier of the application.
   * @param assertion - Text of the assertion.
   * @returns `true` when every text it names was on the page before the action; `false` when it names none, or one that an action produced.
   */
  public shownBefore(application: string, assertion: string): boolean {
    const seen = this.seen.get(application);
    const texts = namedTexts(assertion).map((text) => text.toLowerCase());
    if (seen === undefined || texts.length === 0) return false;
    const within = (lines: ReadonlySet<string>, text: string) => [...lines].some((line) => line.toLowerCase().includes(text));
    return texts.every((text) => within(seen.before, text) && !within(seen.produced, text));
  }

  /** Keeps what a snapshot showed. */
  private record(seen: Seen, snapshot: { page: string; truncated: boolean }): { page: string; truncated: boolean; lines: Set<string> } {
    const lines = new Set(snapshot.page.split("\n").map(normalized).filter((line) => line !== ""));
    for (const line of lines) {
      seen.lines.add(line);
      if (!seen.acted) seen.before.add(line);
    }
    seen.last = lines;
    return { ...snapshot, lines };
  }

  /** The lines of a snapshot that the one before did not show. */
  private appeared(previous: ReadonlySet<string>, lines: ReadonlySet<string>): string[] {
    return [...lines].filter((line) => !previous.has(line));
  }
}

/** A line of a snapshot without its indentation nor the reference of its element, which changes from one snapshot to the next. */
function normalized(line: string): string {
  return line.replace(/\s*\[ref=[^\]]+\]/g, "").trim();
}

/** Whether a line of a snapshot shows what a locator looks for: its role at the start of the line, and its text anywhere in it, whatever the case. */
function shows(line: string, locator: UsedLocator): boolean {
  if (locator.role !== undefined && !new RegExp(`^- '?${locator.role}\\b`).test(line)) return false;
  return locator.text === undefined || line.toLowerCase().includes(locator.text.toLowerCase());
}
