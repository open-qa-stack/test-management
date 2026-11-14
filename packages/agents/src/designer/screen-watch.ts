import type { ToolDefinition } from "@open-qa-stack/domain";
import { scopedToolName, type SpecLocator } from "@open-qa-stack/tools";
import { toolsBySource } from "./index-map.ts";
import { nextMoment } from "./moments.ts";
import { checkable, observed, sameText } from "./observed.ts";

/** The browser tools that change the page of an application. */
const ACTIONS = ["click", "fill", "select_option", "check"];
/** Most lines an action tells the agent appeared. */
const MAX_APPEARED = 60;
/** Most lines an action tells the agent went. */
const MAX_GONE = 20;
/** Most lines of code of the browser tools kept, the last ones. */
const MAX_CODES = 5;
/** Most lines told as the closest to a locator no screen showed. */
const MAX_NEAREST = 5;
/** The start of the line of a field a value is typed in, up to that value when it holds one: its role, its name and its states. */
const FIELD = /^- '?(?:textbox|searchbox|combobox|spinbutton)(?: "(?:[^"\\]|\\.)*")?(?: \[[^\]]+\])*(?:: |:?(?= → )|:?'?$)/;
/** The start of a line of an element with a name: its role, then the name quoted, the whole line quoted when YAML needs it. */
const NAMED = /^- ('?)([a-z]+) "((?:[^"\\]|\\.)*)"/;
/** What the browser tools say they return, which the watch adds to. */
const PAGE_STATE = "Returns where the page is, and the line of code that does the same in a test.";

/** The element a screen showed a text in. */
export interface ShownElement {
  /** The locator a test finds it with. */
  readonly locator: string;
  /** Whether it is a field, which holds the text as its value. */
  readonly field: boolean;
}

/** What the designer saw of the screens of one application. */
interface Seen {
  /** Every line a snapshot showed. */
  readonly lines: Set<string>;
  /** The lines that appeared after an action. */
  readonly produced: Set<string>;
  /** The lines that went after an action. */
  readonly removed: Set<string>;
  /** The moment each value a field held was first seen at, the first seen first. */
  readonly values: Map<string, number>;
  /** The lines of the last snapshot of the whole page. */
  last: Set<string> | undefined;
  /** How many times the agent called one of the browser tools of the application. */
  looks: number;
  /** The lines of code the tools that open or act on a page returned, the last ones, the oldest first. */
  readonly codes: string[];
}

/**
 * Watches what the designer does with the browser tools, so that a test relies on screens it saw.
 *
 * @remarks
 * The tools it gives are those it was given, with what the agent needs to see added to their results, and
 * to their descriptions:
 * opening an address returns the snapshot of the page, and an action returns the lines of the snapshot that
 * appeared after it and those that went. A snapshot is given without what a test has no use for — the reference of each
 * element, the address of each link — so that a long session holds more screens. It remembers, for
 * each application, every line the snapshots showed, those an action produced and those an action
 * removed. An application without a user interface has no such tools, and is
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
    const byApplication = toolsBySource([...byName.keys()], applications);
    const owned = new Map<string, ToolDefinition>();
    for (const application of applications) {
      const snapshot = byName.get(scopedToolName(application, "snapshot"));
      if (snapshot === undefined) continue;
      const seen: Seen = { lines: new Set(), produced: new Set(), removed: new Set(), values: new Map(), last: undefined, looks: 0, codes: [] };
      this.seen.set(application, seen);
      const read = async () => this.record(seen, compact((await snapshot.execute({})) as { page: string; truncated: boolean }), true);
      const wrap = (action: string, execute: (tool: ToolDefinition, args: unknown) => Promise<unknown>, returns?: string) => {
        const tool = byName.get(scopedToolName(application, action))!;
        owned.set(tool.name, {
          ...tool,
          ...(returns === undefined ? {} : { description: tool.description.replace(PAGE_STATE, returns) }),
          execute: (args) => {
            seen.looks += 1;
            return execute(tool, args);
          },
        });
      };
      wrap("snapshot", async (tool, args) => {
        const result = compact((await tool.execute(args)) as { page: string; truncated: boolean });
        this.record(seen, result, (args as { within?: unknown }).within === undefined);
        return result;
      });
      const keep = (state: { code?: unknown }) => {
        if (typeof state.code === "string") seen.codes.push(state.code);
        seen.codes.splice(0, seen.codes.length - MAX_CODES);
      };
      wrap(
        "goto",
        async (tool, args) => {
          const state = (await tool.execute(args)) as object;
          keep(state);
          const shown = await read();
          return { ...state, page: shown.page, truncated: shown.truncated };
        },
        "Returns what the page shows, and the line of code that does the same in a test.",
      );
      for (const action of ACTIONS) {
        wrap(
          action,
          async (tool, args) => {
            const previous = seen.last ?? (await read()).lines;
            const state = (await tool.execute(args)) as object;
            keep(state);
            const current = (await read()).lines;
            const appeared = absent(current, previous);
            for (const line of appeared) seen.produced.add(line);
            const told = appeared.length === 0 ? "Nothing new appeared on the page." : appeared.slice(0, MAX_APPEARED).join("\n");
            const gone = absent(previous, current);
            for (const line of gone) seen.removed.add(line);
            const more = gone.length > MAX_GONE ? [`${gone.length - MAX_GONE} more lines went.`] : [];
            return {
              ...state,
              appeared: told,
              ...(appeared.length > MAX_APPEARED ? { more: `${appeared.length - MAX_APPEARED} more lines appeared; take a snapshot to read them.` } : {}),
              gone: gone.length === 0 ? "Nothing went from the page." : [...gone.slice(0, MAX_GONE), ...more].join("\n"),
            };
          },
          "Returns what appeared, what went, and the line of code that does the same in a test.",
        );
      }
      for (const name of byApplication.get(application)!.filter((name) => !owned.has(name)))
        wrap(name.slice(scopedToolName(application, "").length), (tool, args) => tool.execute(args));
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
   * The lines of code a test writes to do what the agent last did on the pages of an application: what the
   * tools that open or act on a page returned.
   *
   * @param application - Identifier of the application.
   * @returns Five lines at most, the last first; none for an application without a user interface.
   */
  public codes(application: string): string[] {
    return [...(this.seen.get(application)?.codes ?? [])].reverse();
  }

  /**
   * Whether the agent has the browser tools of an application, which its scenarios are held to.
   *
   * @param application - Identifier of the application.
   * @returns `true` for an application with a user interface.
   */
  public watches(application: string): boolean {
    return this.seen.has(application);
  }

  /**
   * How many times the agent looked at the screens of an application: called any of its browser tools.
   *
   * @param application - Identifier of the application.
   * @returns The count; none for an application without a user interface.
   */
  public looks(application: string): number {
    return this.seen.get(application)?.looks ?? 0;
  }

  /**
   * The locators of a test that no screen of the application showed.
   *
   * @param application - Identifier of the application.
   * @param locators - The locators of the test, as its outline reads them.
   * @remarks
   * A screen shows a locator when one of its lines starts with the role, and the name or the text was
   * observed in one of its lines: the name of a row or a list is that of what it holds, on other lines. A
   * name or a text too short to be checked is taken as shown.
   *
   * @returns Each such locator, once by the way the test writes it; none for an application without a user interface.
   */
  public unseen(application: string, locators: readonly SpecLocator[]): SpecLocator[] {
    const seen = this.seen.get(application);
    if (seen === undefined) return [];
    const lines = [...seen.lines];
    const shown = ({ role, text }: SpecLocator) =>
      (role === undefined || lines.some((line) => new RegExp(`^- '?${role}\\b`).test(line))) &&
      (text === undefined || !checkable(text) || observed(text, lines));
    const missed = locators.filter((locator) => !shown(locator));
    return missed.filter((locator, at) => missed.findIndex((other) => other.code === locator.code) === at);
  }

  /**
   * The lines of the screens of an application closest to locators no screen showed, so that the agent
   * picks the element it meant: those that start with the same role or share a word with what a locator
   * looks for, the most shared first. An element the agent can act on ends with its locator.
   *
   * @param application - Identifier of the application.
   * @param locators - The locators no screen showed.
   * @returns Five lines at most, as the snapshots gave them.
   */
  public nearest(application: string, locators: readonly SpecLocator[]): string[] {
    const lines = [...this.seen.get(application)!.lines];
    const score = (line: string) => {
      const words = new Set(wordsOf(line));
      return locators.reduce(
        (total, { role, text }) =>
          total + (role !== undefined && new RegExp(`^- '?${role}\\b`).test(line) ? 1 : 0) + wordsOf(text ?? "").filter((word) => words.has(word)).length,
        0,
      );
    };
    return lines
      .map((line) => ({ line, score: score(line) }))
      .filter((scored) => scored.score > 0)
      .sort((one, other) => other.score - one.score)
      .slice(0, MAX_NEAREST)
      .map((scored) => scored.line);
  }

  /**
   * Whether a screen of the application showed a text, spaces and case aside.
   *
   * @param application - Identifier of the application.
   * @param text - The text.
   * @returns `true` when a line of its snapshots holds it; `false` for an application without a user interface.
   */
  public shows(application: string, text: string): boolean {
    return observed(text, this.seen.get(application)?.lines ?? []);
  }

  /**
   * Whether the first line of the screens of the application that held a text was no field: the agent read
   * the text before it typed it, if it ever did. A field holds a text by its value, not by its name.
   *
   * @param application - Identifier of the application.
   * @param text - The text.
   * @returns `false` when no screen showed the text, when a field showed it first, and for an application
   * without a user interface.
   */
  public showsBeforeTyped(application: string, text: string): boolean {
    const first = [...(this.seen.get(application)?.lines ?? [])].find((line) => observed(text, [fieldValue(line) ?? line]));
    return first !== undefined && fieldValue(first) === undefined;
  }

  /**
   * Whether a screen of the application showed a text in a line of anything but a field: a field holds what
   * the agent typed in it whatever the application answers.
   *
   * @param application - Identifier of the application.
   * @param text - The text.
   * @returns `true` when such a line holds it; `false` for an application without a user interface.
   */
  public showsBesideFields(application: string, text: string): boolean {
    return observed(text, besideFields(this.seen.get(application)?.lines ?? []));
  }

  /**
   * Whether a field of a screen of the application held a text as its value: the agent typed it.
   *
   * @param application - Identifier of the application.
   * @param text - The text.
   * @returns `true` when the value of a field line holds it; `false` for an application without a user interface.
   */
  public typed(application: string, text: string): boolean {
    return this.typedAt(application, text) !== undefined;
  }

  /**
   * When a field of a screen of the application first held a text as its value.
   *
   * @param application - Identifier of the application.
   * @param text - The text.
   * @returns The moment, which `nextMoment` orders; `undefined` when no field held it, and for an application
   * without a user interface.
   */
  public typedAt(application: string, text: string): number | undefined {
    return [...(this.seen.get(application)?.values ?? [])].find(([value]) => observed(text, [value]))?.[1];
  }

  /**
   * The element a screen of the application showed a text in, for an assertion of the text: the element
   * named by the text, else one whose line holds it and ends with its locator, else, for a text expected
   * shown, the field whose value it is. A field holds what the agent typed whatever the application answers,
   * so that any other element comes first, and none is given for a text expected gone.
   *
   * @param application - Identifier of the application.
   * @param text - The text.
   * @param gone - Whether the text is expected gone: the lines an action removed are looked at first, as the
   * lines an action produced are for a text expected shown.
   * @returns The last such element seen, with the locator its line gave, or one by its role and its name for
   * an element named by the text that has none; `undefined` when no line gives one, and for an application
   * without a user interface.
   */
  public locatorOf(application: string, text: string, gone: boolean): ShownElement | undefined {
    const seen = this.seen.get(application);
    if (seen === undefined) return undefined;
    for (const pool of [gone ? seen.removed : seen.produced, seen.lines]) {
      const holding = besideFields(pool)
        .reverse()
        .filter((line) => observed(text, [line]));
      const named = holding.find((line) => namedBy(line, text) !== undefined && !line.includes(" → no "));
      if (named !== undefined) return { locator: locatorIn(named) ?? namedBy(named, text)!, field: false };
      const acted = holding.find((line) => locatorIn(line) !== undefined);
      if (acted !== undefined) return { locator: locatorIn(acted)!, field: false };
    }
    const typedIn = gone ? undefined : [...seen.lines].reverse().find((line) => sameText(fieldValue(line) ?? "", text) && locatorIn(line) !== undefined);
    return typedIn === undefined ? undefined : { locator: locatorIn(typedIn)!, field: true };
  }

  /**
   * Whether an action of the agent made a text appear on a screen of the application, or made one go.
   *
   * @param application - Identifier of the application.
   * @param shows - Texts expected on the screen after an action.
   * @param absent - Texts expected gone from the screen after an action.
   * @returns `true` when one of `shows` was observed in a line an action produced, or one of `absent` in a
   * line an action removed; `true` too when none of them is long enough to be checked. The line of a field
   * is no result, whether it appeared or went: it holds the name of the field and what the agent typed, and
   * changes when the field only gains or loses the focus.
   */
  public changedByAction(application: string, shows: readonly string[], absent: readonly string[]): boolean {
    const seen = this.seen.get(application)!;
    const appeared = shows.filter(checkable);
    const went = absent.filter(checkable);
    if (appeared.length + went.length === 0) return true;
    return appeared.some((text) => observed(text, besideFields(seen.produced))) || went.some((text) => observed(text, besideFields(seen.removed)));
  }

  /** Keeps what a snapshot showed; one of the whole page is the one the next action is compared with. */
  private record(seen: Seen, snapshot: { page: string; truncated: boolean }, whole: boolean): { page: string; truncated: boolean; lines: Set<string> } {
    const lines = new Set(
      snapshot.page
        .split("\n")
        .map(normalized)
        .filter((line) => line !== ""),
    );
    const moment = nextMoment();
    for (const line of lines) {
      seen.lines.add(line);
      const value = fieldValue(line);
      if (value !== undefined && !seen.values.has(value)) seen.values.set(value, moment);
    }
    if (whole) seen.last = lines;
    return { ...snapshot, lines };
  }
}

/** The locator a line ends with; `undefined` when it ends with none. */
function locatorIn(line: string): string | undefined {
  const at = line.indexOf(" → page.");
  return at === -1 ? undefined : line.slice(at + " → ".length);
}

/** The locator by role and name of the element of a line whose name is a text; `undefined` when its name is another. */
function namedBy(line: string, text: string): string | undefined {
  const start = NAMED.exec(line);
  if (start === null) return undefined;
  const [, quoted, role, escaped] = start as unknown as [string, string, string, string];
  const name = JSON.parse(`"${quoted === "" ? escaped : escaped.replaceAll("''", "'")}"`) as string;
  return sameText(name, text) ? `page.getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(name)}, exact: true })` : undefined;
}

/** The lines that are no line of a field, in their order. */
function besideFields(lines: Iterable<string>): string[] {
  return [...lines].filter((line) => fieldValue(line) === undefined);
}

/** The value a field line holds, before the locator of the field, empty when it holds none; `undefined` for a line of anything else. */
function fieldValue(line: string): string | undefined {
  const start = FIELD.exec(line);
  if (start === null) return undefined;
  const value = line.slice(start[0].length);
  const end = value.indexOf(" → ");
  return end === -1 ? value : value.slice(0, end);
}

/** The words of a text that can tell an element, three letters or more, in lower case. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3);
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
