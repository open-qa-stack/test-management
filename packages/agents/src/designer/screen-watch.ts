import type { PlannedScenario, ToolDefinition } from "@open-qa-stack/domain";
import { changingName, destructiveName, scopedToolName, type SpecLocator, type Target, type TargetMatch, type TargetScope } from "@open-qa-stack/tools";
import { screenRoute } from "../application-explorer/screen-trail.ts";
import { toolsBySource } from "./index-map.ts";
import { nextMoment } from "./moments.ts";
import { checkable, observed, sameText } from "./observed.ts";

/** The browser tools that change the page of an application. */
const ACTIONS = ["click", "fill", "select_option", "check"];
/** Most lines an action tells the agent appeared. */
const MAX_APPEARED = 60;
/** Most lines an action tells the agent went. */
const MAX_GONE = 20;
/** Most lines of code of the browser tools given as the last ones. */
const MAX_CODES = 5;
/** Most elements of one snapshot whose locator is checked on the page. */
const MAX_CHECKED = 200;
/** Most parts of the page, the closest first, a locator of one element among several is looked for in. */
const MAX_SCOPES = 3;
/** What joins the identifiers of the applications of a scope: no identifier, a slug, holds it. */
const JOINED = "+";

/**
 * The scope of a test: its application, or its applications taken as one when it acts on several. Every
 * question a `ScreenWatch` answers about an application, it answers about a scope.
 *
 * @param applications - Identifiers of the applications, the one the test is of first.
 * @returns The scope, such as `shop` or `shop+desk`.
 */
export function screenScope(applications: readonly string[]): string {
  return [...new Set(applications)].join(JOINED);
}

/**
 * The scope of the test of a scenario: its application, with the others it acts on when it is a test of several.
 *
 * @param scenario - The scenario.
 * @returns The scope.
 */
export function scenarioScope(scenario: Pick<PlannedScenario, "application" | "applications">): string {
  return screenScope([scenario.application, ...(scenario.applications ?? [])]);
}

/** Whether an application is of a scope. */
function within(scope: string, application: string): boolean {
  return scope.split(JOINED).includes(application);
}

/** The site an address without one is read on: only its route is kept. */
const LOCAL = "https://screen.local";
/** How a snapshot ends the line of an element several elements share the locator of: their number, then the locator. */
const SHARED = / → no unique locator: (\d+) elements match (page\..+)$/;
/** Most lines told as the closest to a locator no screen showed. */
const MAX_NEAREST = 5;
/** The start of the line of a field a value is typed in, up to that value when it holds one: its role, its name and its states. */
const FIELD = /^- '?(?:textbox|searchbox|combobox|spinbutton)(?: "(?:[^"\\]|\\.)*")?(?: \[[^\]]+\])*(?:: |:?(?= → )|:?'?$)/;
/** The start of a line of an element with a name: its role, then the name quoted, the whole line quoted when YAML needs it. */
const NAMED = /^- ('?)([a-z]+) "((?:[^"\\]|\\.)*)"/;
/** The state of the element that has the focus, which an action moves without changing what the page shows. */
const FOCUS = / \[active\]/g;
/** What the browser tools say they return, which the watch adds to. */
const PAGE_STATE = "Returns where the page is, and the line of code that does the same in a test.";
/** How the description of a tool that opens or acts on a page ends: what the number of its action is for. */
const ACTION_NUMBER = '"action", its number: a plan cites it in the steps the action does.';

/** The element a screen showed a text in, as its locator was checked on the page while the screen showed it. */
export interface ShownElement {
  /** The locator a test finds it with. */
  readonly locator: string;
  /** Whether it is a field, which holds the text as its value. */
  readonly field: boolean;
  /** How many elements the locator designated on the page: one for an element a test asserts on as it is, none when the page showed no such element, more when several share it. */
  readonly count: number;
  /** The locator of one of several elements alone, inside the part of the page that holds it, when one was found. */
  readonly narrower?: string;
}

/**
 * Counts, on the page of an application as it is now, the elements each target designates, as the browser
 * tools do.
 */
export type TargetMatcher = (application: string, targets: readonly CheckedTarget[]) => Promise<readonly TargetMatch[]>;

/** An element by its role and its exact name, inside a part of the page or not: a target of the browser tools. */
export type NamedTarget = Extract<Target, { role: string }> & { readonly name: string };

/** A text the page shows in an element without a name, such as a paragraph: a target of the browser tools by its exact text. */
export type TextTarget = Extract<Target, { text: string }>;

/** An element the watch counts on the page: one with a name, or a text. */
export type CheckedTarget = NamedTarget | TextTarget;

/** What the locator of the element of a line designated on the page while the screen showed the line. */
interface Checked {
  readonly locator: string;
  readonly count: number;
  readonly narrower?: string;
}

/** An action the agent did on a page with a browser tool: it opened an address, clicked, typed, chose or checked. */
export interface WatchedAction {
  /** Its number, from 1, in the order the actions were done, whatever their application. */
  readonly number: number;
  /** Identifier of the application it was done on. */
  readonly application: string;
  /** What its tool does: `goto`, `click`, `fill`, `select_option` or `check`. */
  readonly tool: string;
  /** The line of code that does the same in a test, as the tool returned it. */
  readonly code: string;
  /** The value it typed or chose, when it was given as a text: the credential of an account is not. */
  readonly typed?: string;
  /** The screen the page was on once it was done, by its route, when its tool said where the page was. */
  readonly screen?: string;
  /** The name of the element it clicked, when that name says the click creates, changes or removes data of the application. */
  readonly changes?: string;
  /** The address it opened, as the agent gave it, when it opened one. */
  readonly opened?: string;
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
  /** The values a field held that a line beside the fields showed after an action that changed them: what was searched found them. */
  readonly found: Set<string>;
  /** The values a field held that an action left shown only in the fields, though a screen showed them beside: what was searched matched nothing. */
  readonly unmatched: Set<string>;
  /** The values the agent typed in a field. */
  readonly filled: Set<string>;
  /** The addresses an action of the agent, other than opening one itself, led the application to. */
  readonly reached: Set<string>;
  /** What the locator by role and name of each line of a named element without a locator of its own designated on the page, the last time the line came. */
  readonly checked: Map<string, Checked>;
  /** The lines of the last snapshot of the whole page. */
  last: Set<string> | undefined;
  /** How many times the agent called one of the browser tools of the application. */
  looks: number;
}

/**
 * Watches what the designer does with the browser tools, so that a test relies on screens it saw.
 *
 * @remarks
 * The tools it gives are those it was given, with what the agent needs to see added to their results, and
 * to their descriptions:
 * opening an address returns the snapshot of the page, and an action returns the lines of the snapshot that
 * appeared after it and those that went. Each of them that returned its line of code is numbered, from 1, and
 * returns its number in `action`: the watch keeps every action with its number, its tool, its line of code and
 * the value it typed, so that a plan cites the actions that do its steps. When a value a field holds is no longer shown beside the fields
 * after an action, though a line that went showed it, or, for a value the agent typed, a screen before showed
 * it beside the fields and the action removed a line beside them, the focus aside, and no action before found it — changed
 * what the page shows beside the fields while a line there showed it — the action adds a note: what was
 * typed matched nothing, and a part of it may; the watch keeps the value as searched in vain. A row the search found then removed is no such value. A snapshot is given without what a test has no use for — the reference of each
 * element, the address of each link — so that a long session holds more screens. It remembers, for
 * each application, every line the snapshots showed, those an action produced and those an action
 * removed. Each time it reads a snapshot, it checks on the page, without the model, the locator by role and
 * name of each named element the snapshot gives no locator of its own, for the lines the page did not show
 * before: how many elements it designates, whether the page shows the one it designates, and, for several,
 * the locator of one alone inside a named part of the page that holds it. An application without a user
 * interface has no such tools, and is held to nothing.
 */
export class ScreenWatch {
  private readonly seen = new Map<string, Seen>();
  private readonly done: WatchedAction[] = [];
  /** For each action, by its number: the lines the page showed between it and the next action on its application, and those it removed. */
  private readonly after = new Map<number, { readonly shown: Set<string>; readonly removed: Set<string> }>();
  private readonly watched: ToolDefinition[];
  /** The browser tools as they were given, by name: the harness looks at a page with them without the look counting as one of the agent. */
  private readonly given: ReadonlyMap<string, ToolDefinition>;
  private readonly matches: TargetMatcher;

  /**
   * @param applications - Identifiers of the applications the browser tools may be of.
   * @param tools - The browser tools, named after their application.
   * @param matches - Counts what a locator designates on the page of an application; without one, as for
   * tools behind which there is no page to look at, each locator is held to designate one element.
   */
  public constructor(applications: readonly string[], tools: readonly ToolDefinition[], matches: TargetMatcher = oneEach) {
    this.matches = matches;
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const byApplication = toolsBySource([...byName.keys()], applications);
    const owned = new Map<string, ToolDefinition>();
    for (const application of applications) {
      const snapshot = byName.get(scopedToolName(application, "snapshot"));
      if (snapshot === undefined) continue;
      const seen: Seen = {
        lines: new Set(),
        produced: new Set(),
        removed: new Set(),
        values: new Map(),
        found: new Set(),
        unmatched: new Set(),
        filled: new Set(),
        reached: new Set(),
        checked: new Map(),
        last: undefined,
        looks: 0,
      };
      this.seen.set(application, seen);
      const read = async () => this.record(application, seen, compact((await snapshot.execute({})) as { page: string; truncated: boolean }), true);
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
        await this.record(application, seen, result, (args as { within?: unknown }).within === undefined);
        return result;
      });
      // An action is one whose tool returned its line of code: it is numbered, and its result gives the number.
      const numbered = <T extends { code?: unknown }>(action: string, state: T, typed?: string, changes?: string, opened?: string): T => {
        if (typeof state.code !== "string") return state;
        const number = this.done.length + 1;
        const { url } = state as { url?: unknown };
        const at = typeof url === "string" && URL.canParse(url, LOCAL) ? new URL(url, LOCAL) : undefined;
        // An action that does not say where the page is leaves it on the screen of the action before it.
        const screen = at === undefined ? this.done.findLast((done) => done.application === application)?.screen : screenRoute(at.href, at, at);
        this.done.push({
          number,
          application,
          tool: action,
          code: state.code,
          ...(typed === undefined ? {} : { typed }),
          ...(screen === undefined ? {} : { screen }),
          ...(changes === undefined ? {} : { changes }),
          ...(opened === undefined ? {} : { opened }),
        });
        this.after.set(number, { shown: new Set(), removed: new Set() });
        return { ...state, action: number };
      };
      wrap(
        "goto",
        async (tool, args) => {
          const { url } = args as { url?: unknown };
          const state = numbered("goto", (await tool.execute(args)) as { code?: unknown }, undefined, undefined, typeof url === "string" ? url : undefined);
          const shown = await read();
          return { ...state, page: shown.page, truncated: shown.truncated };
        },
        `Returns what the page shows, the line of code that does the same in a test, and ${ACTION_NUMBER}`,
      );
      for (const action of ACTIONS) {
        wrap(
          action,
          async (tool, args) => {
            const previous = seen.last ?? (await read()).lines;
            const before = besideFields(seen.lines);
            const { value, option } = args as { value?: unknown; option?: unknown };
            if (action === "fill" && typeof value === "string") seen.filled.add(value);
            const typed = [value, option].find((given): given is string => typeof given === "string");
            // A click on an element whose name says it creates, changes or removes data: the scenario that cites it writes.
            const { target } = args as { target?: Target };
            const changes = action !== "click" || target === undefined ? undefined : (changingName(target) ?? destructiveName(target));
            const state = numbered(action, (await tool.execute(args)) as { code?: unknown; url?: unknown }, typed, changes);
            // Where a click led is what the application answered, such as the address of the record it opened.
            if (typeof state.url === "string") seen.reached.add(state.url);
            const current = (await read()).lines;
            const appeared = absent(current, previous);
            for (const line of appeared) seen.produced.add(line);
            const told = appeared.length === 0 ? "Nothing new appeared on the page." : appeared.slice(0, MAX_APPEARED).join("\n");
            const gone = absent(previous, current);
            for (const line of gone) seen.removed.add(line);
            const done = this.after.get((state as { action?: number }).action ?? 0);
            for (const line of gone) done?.removed.add(line);
            const more = gone.length > MAX_GONE ? [`${gone.length - MAX_GONE} more lines went.`] : [];
            const unmatched = unmatchedValues(current, appeared, gone, before, seen.filled).filter((value) => !seen.found.has(value));
            for (const value of unmatched) seen.unmatched.add(value);
            for (const value of foundValues(current, appeared, gone)) seen.found.add(value);
            return {
              ...state,
              appeared: told,
              ...(appeared.length > MAX_APPEARED ? { more: `${appeared.length - MAX_APPEARED} more lines appeared; take a snapshot to read them.` } : {}),
              gone: gone.length === 0 ? "Nothing went from the page." : [...gone.slice(0, MAX_GONE), ...more].join("\n"),
              ...(unmatched.length === 0 ? {} : { note: unmatched.map(unmatchedNote).join("\n") }),
            };
          },
          `Returns what appeared, what went, the line of code that does the same in a test, and ${ACTION_NUMBER}`,
        );
      }
      for (const name of byApplication.get(application)!.filter((name) => !owned.has(name)))
        wrap(name.slice(scopedToolName(application, "").length), (tool, args) => tool.execute(args));
    }
    this.watched = tools.map((tool) => owned.get(tool.name) ?? tool);
    this.given = new Map(tools.map((tool) => [tool.name, tool]));
  }

  /**
   * What was seen of an application, or of several taken as one: the scope of a test that acts on several
   * applications is their identifiers joined, as `screenScope` gives it.
   */
  private view(scope: string): Seen | undefined {
    const seen = scope.split(JOINED).flatMap((application) => this.seen.get(application) ?? []);
    if (seen.length <= 1) return seen[0];
    const all = <T>(sets: (one: Seen) => Iterable<T>) => new Set(seen.flatMap((one) => [...sets(one)]));
    return {
      lines: all((one) => one.lines),
      produced: all((one) => one.produced),
      removed: all((one) => one.removed),
      values: new Map(seen.flatMap((one) => [...one.values]).sort(([, first], [, second]) => first - second)),
      found: all((one) => one.found),
      unmatched: all((one) => one.unmatched),
      filled: all((one) => one.filled),
      reached: all((one) => one.reached),
      checked: new Map(seen.flatMap((one) => [...one.checked])),
      last: undefined,
      looks: seen.reduce((total, one) => total + one.looks, 0),
    };
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
    return this.actions(application)
      .slice(-MAX_CODES)
      .reverse()
      .map((action) => action.code);
  }

  /**
   * An action the agent did, by the number its result gave.
   *
   * @param number - The number.
   * @returns The action; `undefined` when no action has that number.
   */
  public action(number: number): WatchedAction | undefined {
    return this.done[number - 1];
  }

  /**
   * The actions the agent did on the pages of an application.
   *
   * @param application - Identifier of the application.
   * @returns They, in the order they were done; none for an application without a user interface.
   */
  public actions(application: string): WatchedAction[] {
    return this.done.filter((action) => within(application, action.application));
  }

  /**
   * Whether the agent has the browser tools of an application, which its scenarios are held to.
   *
   * @param application - Identifier of the application.
   * @returns `true` for an application with a user interface.
   */
  public watches(application: string): boolean {
    return application.split(JOINED).some((one) => this.seen.has(one));
  }

  /**
   * How many times the agent looked at the screens of an application: called any of its browser tools.
   *
   * @param application - Identifier of the application.
   * @returns The count; none for an application without a user interface.
   */
  public looks(application: string): number {
    return this.view(application)?.looks ?? 0;
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
    const seen = this.view(application);
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
    const lines = [...this.view(application)!.lines];
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
    return observed(text, this.view(application)?.lines ?? []);
  }

  /**
   * Whether an address the application went to after an action of the agent holds a text, such as the
   * identifier of the record a click opened, which no line of a screen shows. An address the agent opened
   * itself is no answer of the application, and does not count.
   *
   * @param application - Identifier of the application.
   * @param text - The text.
   * @returns `true` when such an address holds it; `false` for an application without a user interface.
   */
  public reached(application: string, text: string): boolean {
    return observed(text, [...(this.view(application)?.reached ?? [])]);
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
    const first = [...(this.view(application)?.lines ?? [])].find((line) => observed(text, [fieldValue(line) ?? line]));
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
    return observed(text, besideFields(this.view(application)?.lines ?? []));
  }

  /**
   * Whether a screen of the application showed a text in a line other than a field that holds a value the
   * agent typed: what the application gave, not what the agent typed.
   *
   * @param application - Identifier of the application.
   * @param text - The text.
   * @returns `true` when such a line holds it; `false` for an application without a user interface.
   */
  public showsUntyped(application: string, text: string): boolean {
    const seen = this.view(application);
    return (
      seen !== undefined &&
      observed(
        text,
        [...seen.lines].filter((line) => !typedIn(seen, line)),
      )
    );
  }

  /**
   * How the screens of the application showed a text that they showed only in fields: in the value the
   * agent typed in one, in a value one held that the agent did not type, or in the name or the states of one.
   *
   * @param application - Identifier of the application.
   * @param text - The text.
   * @returns `value` when a field held it in a value the agent did not type, else `typed` when it is in one
   * the agent typed, else `name`; `undefined` when a line beside the fields showed it, when no screen showed
   * it, and for an application without a user interface.
   */
  public onlyInFields(application: string, text: string): "typed" | "value" | "name" | undefined {
    const seen = this.view(application);
    if (seen === undefined || !observed(text, seen.lines) || observed(text, besideFields(seen.lines))) return undefined;
    const holding = [...seen.lines].filter((line) => observed(text, [fieldValue(line) ?? ""]));
    if (holding.some((line) => !typedIn(seen, line))) return "value";
    return holding.length > 0 ? "typed" : "name";
  }

  /**
   * Whether the agent searched a value in vain: an action left it only in the fields, though a screen showed
   * it beside them, and no action found it. A search may tell the case of what it is given.
   *
   * @param application - Identifier of the application.
   * @param value - The value, exactly as a field held it.
   * @returns `true` when the note of such an action named it; `false` for an application without a user interface.
   */
  public unmatched(application: string, value: string): boolean {
    const seen = this.view(application);
    return seen !== undefined && seen.unmatched.has(value) && !seen.found.has(value);
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
    return [...(this.view(application)?.values ?? [])].find(([value]) => observed(text, [value]))?.[1];
  }

  /**
   * The element a screen of the application showed a text in, for an assertion of the text: the element
   * named by the text, else one whose line holds it and ends with its locator, else, for a text expected
   * shown, the field whose value it is. A field holds what the agent typed whatever the application answers,
   * so that any other element comes first, and none is given for a text expected gone.
   *
   * @remarks
   * Each locator was checked on the page while the screen showed its line: by the snapshot, for a locator a
   * line ends with, or by the watch, for one by the role and the name of an element named by the text. An
   * element whose locator was not checked is never given. One whose locator designated it alone comes first;
   * failing one, an element several share the locator of, with their number and the locator of one of them
   * alone when the watch found one; failing that, the field; failing that, an element whose locator
   * designated nothing the page showed.
   *
   * @param application - Identifier of the application.
   * @param text - The text.
   * @param gone - Whether the text is expected gone: the lines an action removed are looked at first, as the
   * lines an action produced are for a text expected shown.
   * @param actions - The numbers of the actions that do the step the text is expected after, in order. When
   * given, only the screen of the step is looked at: for a text expected shown, the lines the page showed
   * between the last of them and the next action; for a text expected gone, the lines they removed, then
   * every line seen. A text expected shown that only another screen showed in an element has no element here.
   * @returns The last such element seen; `undefined` when no line gives one, and for an application without
   * a user interface.
   */
  public locatorOf(application: string, text: string, gone: boolean, actions: readonly number[] = []): ShownElement | undefined {
    const seen = this.view(application);
    if (seen === undefined) return undefined;
    const states = actions.flatMap((number) => this.after.get(number) ?? []);
    const last = states.at(-1);
    const stepLines = last === undefined ? undefined : gone ? new Set(states.flatMap((state) => [...state.removed])) : last.shown;
    // A text expected gone that the step removed no line of was shown by an earlier screen: its element is looked for there.
    const pools = stepLines === undefined ? [gone ? seen.removed : seen.produced, seen.lines] : gone ? [stepLines, seen.lines] : [stepLines];
    const found: ShownElement[] = [];
    for (const pool of pools) {
      const holding = besideFields(pool)
        .reverse()
        .filter((line) => observed(text, [line]));
      found.push(
        ...holding
          .filter((line) => namedBy(line, text) !== undefined || sameText(textTarget(line)?.text ?? "", text))
          .flatMap((line) => namedElement(seen, line)),
      );
      found.push(...holding.flatMap((line) => locatorIn(line) ?? []).map((locator) => ({ locator, field: false, count: 1 })));
    }
    const typedIn = gone
      ? undefined
      : [...(last?.shown ?? seen.lines)].reverse().find((line) => sameText(fieldValue(line) ?? "", text) && locatorIn(line) !== undefined);
    const field = typedIn === undefined ? [] : [{ locator: locatorIn(typedIn)!, field: true, count: 1 }];
    return (
      found.find((element) => element.count === 1) ??
      found.find((element) => element.count > 1) ??
      [...field, ...found.filter((element) => element.count === 0)][0]
    );
  }

  /**
   * Whether the page of an application shows texts beside its fields, now, once an address is opened again:
   * the harness looks by itself, and its look is none of the agent's — neither an action nor a screen it saw.
   *
   * @param application - Identifier of the application.
   * @param address - The address to open, as the agent gave it to its tool.
   * @param texts - The texts looked for.
   * @returns Those the page does not show; none when it shows them all, and `undefined` when the page could
   * not be opened or read, which holds a plan to nothing.
   */
  public async missingAt(application: string, address: string, texts: readonly string[]): Promise<string[] | undefined> {
    try {
      await this.given.get(scopedToolName(application, "goto"))!.execute({ url: address });
      const shown = (await this.given.get(scopedToolName(application, "snapshot"))!.execute({})) as { page: string };
      // The page of the agent moved: its next action is compared with what the page shows then.
      this.seen.get(application)!.last = undefined;
      const lines = besideFields(pageLines(shown.page));
      return texts.filter((text) => !observed(text, lines));
    } catch {
      return undefined;
    }
  }

  /**
   * The screens the actions of the agent left the page on, each once.
   *
   * @returns Each by its application then its route, such as `shop /orders`, in the order the agent reached them.
   */
  public visited(): string[] {
    return [...new Set(this.done.flatMap((action) => (action.screen === undefined ? [] : [`${action.application} ${action.screen}`])))];
  }

  /**
   * The screen an action acts on: the one it opens, for an address, or else the one the action before it on
   * its application left the page on.
   *
   * @param number - The number of the action.
   * @returns The route of the screen; `undefined` for an action unknown, or when no tool told where the page was.
   */
  public actedOn(number: number): string | undefined {
    const done = this.action(number);
    if (done === undefined || done.tool === "goto") return done?.screen;
    return this.done.findLast((before) => before.number < number && before.application === done.application)?.screen ?? done.screen;
  }

  /**
   * The actions after which the screen of an application showed a text beside its fields: the screen of an
   * action is what the page showed between it and the next action on its application.
   *
   * @param application - Identifier of the application.
   * @param text - The text.
   * @returns The numbers of those actions, in the order they were done; none for an application without a
   * user interface.
   */
  public shownAfter(application: string, text: string): number[] {
    return this.done
      .filter((action) => within(application, action.application) && observed(text, besideFields(this.after.get(action.number)!.shown)))
      .map((action) => action.number);
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
    const seen = this.view(application)!;
    const appeared = shows.filter(checkable);
    const went = absent.filter(checkable);
    if (appeared.length + went.length === 0) return true;
    return appeared.some((text) => observed(text, besideFields(seen.produced))) || went.some((text) => observed(text, besideFields(seen.removed)));
  }

  /**
   * Keeps the lines of a page the runner showed rather than a tool, such as the page at the failure of a
   * run: lines the screens of the application showed, which no action produced nor removed.
   *
   * @param application - Identifier of the application; nothing is kept for one without a user interface.
   * @param lines - The lines of the page, as `snapshotLines` gives them.
   */
  public recordPage(application: string, lines: readonly string[]): void {
    // The runner does not say which application of a scope its page was of: each keeps the lines.
    for (const one of application.split(JOINED)) for (const line of lines) this.seen.get(one)?.lines.add(line);
  }

  /** Keeps what a snapshot showed, the locators of its new lines checked on the page; one of the whole page is the one the next action is compared with. */
  private async record(
    application: string,
    seen: Seen,
    snapshot: { page: string; truncated: boolean },
    whole: boolean,
  ): Promise<{ page: string; truncated: boolean; lines: Set<string> }> {
    const lines = new Set(pageLines(snapshot.page));
    const moment = nextMoment();
    await this.check(application, seen, snapshot.page);
    const latest = this.done.findLast((action) => action.application === application);
    const shown = latest === undefined ? undefined : this.after.get(latest.number)!.shown;
    for (const line of lines) {
      seen.lines.add(line);
      shown?.add(line);
      // What the page shows once an action was done is a result of the actions: what an address opened shows, as what a click made appear.
      if (shown !== undefined) seen.produced.add(line);
      const value = fieldValue(line);
      if (value !== undefined && !seen.values.has(value)) seen.values.set(value, moment);
    }
    if (whole) seen.last = lines;
    return { ...snapshot, lines };
  }

  /**
   * Checks on the page, while it shows them, the locator by role and name of each named element a snapshot
   * gave no locator of its own, for the lines the page did not show before: how many elements it designates
   * and, for several, whether it designates one alone inside one of the named parts of the page that hold the
   * first of them, the closest first.
   */
  private async check(application: string, seen: Seen, page: string): Promise<void> {
    const tree = page.split("\n");
    const fresh = new Map<string, { readonly target: CheckedTarget; readonly scopes: readonly TargetScope[] }>();
    tree.forEach((raw, at) => {
      const line = normalized(raw);
      // An element with a name, or a text an element without one shows: both are counted, so that an assertion knows what it finds.
      const target = namedTarget(line) ?? textTarget(line);
      if (target !== undefined && !line.includes(" → ") && seen.last?.has(line) !== true && !fresh.has(line) && fresh.size < MAX_CHECKED)
        fresh.set(line, { target, scopes: scopesOf(tree, at) });
    });
    const elements = [...fresh];
    // A page that cannot be looked at, such as one that navigates, leaves its locators unchecked: none of them is given.
    const unread = (): readonly TargetMatch[] => [];
    const targets = elements.map(([, { target }]) => target);
    const counted = await this.matches(application, targets).catch(unread);
    for (const [at, [line, { target, scopes }]] of elements.slice(0, counted.length).entries()) {
      const { code, count, visible } = counted[at]!;
      const within = scopes.map((scope) => ({ ...target, within: scope }));
      const scoped = count > 1 ? await this.matches(application, within).catch(unread) : [];
      const narrower = scoped.find((match) => match.visible)?.code;
      seen.checked.set(line, { locator: code, count: count === 1 && !visible ? 0 : count, ...(narrower === undefined ? {} : { narrower }) });
    }
  }
}

/** What every target designates when there is no page to look at: one element, which the page shows. */
async function oneEach(_application: string, targets: readonly CheckedTarget[]): Promise<TargetMatch[]> {
  return targets.map((target) => ({ code: "text" in target ? textLocator(target.text) : namedLocator(target), count: 1, visible: true }));
}

/** The element of a line named by a text, as its locator was checked: none when it was not, or when its line says no locator reaches it. */
function namedElement(seen: Seen, line: string): ShownElement[] {
  const own = locatorIn(line);
  if (own !== undefined) return [{ locator: own, field: false, count: 1 }];
  const shared = SHARED.exec(line);
  if (shared !== null) return [{ locator: shared[2]!, field: false, count: Number(shared[1]) }];
  const checked = line.includes(" → ") ? undefined : seen.checked.get(line);
  return checked === undefined ? [] : [{ ...checked, field: false }];
}

/** The named parts of the page that hold the element of a line of a snapshot, the closest first, `MAX_SCOPES` at most. */
function scopesOf(tree: readonly string[], at: number): TargetScope[] {
  const scopes: TargetScope[] = [];
  let indent = indentOf(tree[at]!);
  for (let above = at - 1; above >= 0 && scopes.length < MAX_SCOPES; above -= 1) {
    if (indentOf(tree[above]!) >= indent) continue;
    indent = indentOf(tree[above]!);
    // A part with a name, such as a row, or one of the page told by its role alone, such as its table or a dialog.
    const scope = namedTarget(normalized(tree[above]!)) ?? partOf(normalized(tree[above]!));
    if (scope !== undefined) scopes.push(scope);
  }
  return scopes;
}

/** How far a line of a snapshot is indented. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Whether a line is that of a field holding a value the agent typed. */
function typedIn(seen: Seen, line: string): boolean {
  const value = fieldValue(line);
  return value !== undefined && [...seen.filled].some((filled) => sameText(filled, value));
}

/**
 * The values the fields of a page hold that no line beside the fields shows after an action, though a line
 * beside the fields that went showed them, or, for a value the agent typed, when the action removed a line
 * beside the fields otherwise than by the focus, as a search filters a list, a line beside the fields of a
 * screen before: what was searched matched nothing. An action that only adds lines, such as one that tells
 * a field is missing, filtered nothing.
 */
function unmatchedValues(
  current: ReadonlySet<string>,
  appeared: readonly string[],
  gone: readonly string[],
  before: readonly string[],
  typed: ReadonlySet<string>,
): string[] {
  const shown = besideFields(current);
  const went = besideFields(gone);
  const came = unfocused(appeared);
  const filtered = unfocused(gone).some((line) => !came.includes(line));
  return fieldValues(current).filter(
    (value) => !observed(value, shown) && (observed(value, went) || (filtered && typed.has(value) && observed(value, before))),
  );
}

/**
 * The values the fields of a page hold that a line beside the fields shows, after an action that changed a
 * line beside the fields otherwise than by the focus: what was searched found them.
 */
function foundValues(current: ReadonlySet<string>, appeared: readonly string[], gone: readonly string[]): string[] {
  if (!changedBesideFields(appeared, gone)) return [];
  const shown = besideFields(current);
  return fieldValues(current).filter((value) => observed(value, shown));
}

/** The lines beside the fields, without the mark of the focus. */
function unfocused(lines: readonly string[]): string[] {
  return besideFields(lines).map((line) => line.replace(FOCUS, ""));
}

/** Whether an action changed a line beside the fields otherwise than by the focus. */
function changedBesideFields(appeared: readonly string[], gone: readonly string[]): boolean {
  const went = unfocused(gone);
  const came = unfocused(appeared);
  return !(came.every((line) => went.includes(line)) && went.every((line) => came.includes(line)));
}

/** The values the fields of a page hold, long enough to be checked, once each. */
function fieldValues(lines: ReadonlySet<string>): string[] {
  return [...new Set([...lines].flatMap((line) => fieldValue(line) ?? []))].filter(checkable);
}

/** What the agent is told of a value it typed that the page no longer shows beside the fields. */
function unmatchedNote(value: string): string {
  return `Nothing beside the fields shows "${value}" now, though a screen showed it: if you searched it, it matched nothing. Try a part of it, such as a first or a last name.`;
}

/** The locator a line ends with; `undefined` when it ends with none. */
function locatorIn(line: string): string | undefined {
  const at = line.indexOf(" → page.");
  return at === -1 ? undefined : line.slice(at + " → ".length);
}

/** The element of a line by its role and its name; `undefined` for a line of an element without a name. */
function namedTarget(line: string): { role: string; name: string } | undefined {
  const start = NAMED.exec(line);
  if (start === null) return undefined;
  const [, quoted, role, escaped] = start as unknown as [string, string, string, string];
  return { role, name: JSON.parse(`"${quoted === "" ? escaped : escaped.replaceAll("''", "'")}"`) as string };
}

/** The start of a line of a part of the page told by its role alone: one a page has few of, which holds what an assertion looks for. */
const PART = /^- '?(table|dialog|alertdialog|form|navigation|main|list|region|banner|contentinfo|article|alert|status)(?: \[[^\]]+\])*:?'?$/;
/** The line of an element without a name that shows a text: its role, then the text. */
const TEXTED = /^- [a-z]+: (.+)$/;

/** The part of the page a line starts, when it has no name: by its role alone. */
function partOf(line: string): TargetScope | undefined {
  const start = PART.exec(line);
  return start === null ? undefined : { role: start[1]! };
}

/** The text an element without a name shows, as a target: none for a field, an element with a name, or a text too short to tell anything. */
function textTarget(line: string): TextTarget | undefined {
  if (FIELD.test(line) || NAMED.test(line)) return undefined;
  const shown = TEXTED.exec(line.split(" → ")[0]!)?.[1];
  if (shown === undefined) return undefined;
  // YAML quotes a text that holds a colon or starts with a mark.
  const text = /^".*"$/.test(shown) ? (JSON.parse(shown) as string) : shown;
  return checkable(text) ? { text } : undefined;
}

/** The locator of an element by its exact text, as a test writes it. */
function textLocator(text: string): string {
  return `page.getByText(${JSON.stringify(text)}, { exact: true })`;
}

/** The locator of an element by its role and its exact name, as a test writes it. */
function namedLocator({ role, name }: { role: string; name: string }): string {
  return `page.getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(name)}, exact: true })`;
}

/** The element of a line whose name is a text; `undefined` when its name is another. */
function namedBy(line: string, text: string): { role: string; name: string } | undefined {
  const target = namedTarget(line);
  return target !== undefined && sameText(target.name, text) ? target : undefined;
}

/**
 * The lines of a snapshot of a page as the watch keeps them: without their indentation, the reference of each
 * element, the mark of what can be clicked, nor the address of each link.
 *
 * @param page - The snapshot, as a tool or the runner wrote it.
 * @returns Its lines, but the empty ones, in their order.
 */
export function snapshotLines(page: string): string[] {
  return pageLines(compact({ page }).page);
}

/**
 * The lines that are no line of a field, in their order: a field holds what the agent typed whatever the
 * application answers.
 *
 * @param lines - Lines of snapshots.
 * @returns Those of anything but a field.
 */
export function besideFields(lines: Iterable<string>): string[] {
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

/** The lines of a snapshot without their indentation, but the empty ones. */
function pageLines(page: string): string[] {
  return page
    .split("\n")
    .map(normalized)
    .filter((line) => line !== "");
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
