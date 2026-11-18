import { camelName } from "@open-qa-stack/domain";

/** A locator of a screen, as a member of its page object. */
export interface LocatorMember {
  /** Its name, before any number that tells it from another of the same name. */
  readonly name: string;
  /** The names of what it is given: the name of each element the locator is found within. */
  readonly parameters: readonly string[];
  /** The locator, after `page.`, with each parameter in the place of its text. */
  readonly expression: string;
}

/** An action a line of code does on a locator: the member the locator becomes, and the rest of the line. */
export interface MemberAction {
  readonly member: LocatorMember;
  /** The texts the line gives for the parameters of the member, as it writes them. */
  readonly given: readonly string[];
  /** What the line does on the locator, such as `click()` or `fill("Ado")`. */
  readonly action: string;
}

/** A text between double quotes, as a line of code writes it. */
const TEXT = String.raw`"(?:[^"\\]|\\.)*"`;
/** A line of code that acts on `page`. */
const LINE = /^await page\.(.+);$/s;
/** A call that finds an element: its method, the text it is first given, and the name it asks for, if any. */
const FOUND = new RegExp(String.raw`^(getBy[A-Z]\w*)\((${TEXT})(.*)\)$`, "s");
const NAMED = new RegExp(String.raw`\bname: (${TEXT})`);

/** What an element found by a method other than its role is called. */
const KINDS: Readonly<Record<string, string>> = { getByLabel: "field", getByPlaceholder: "field", getByText: "text", getByAltText: "image" };

/** Most words of the name of an element kept in the name of its member. */
const MAX_WORDS = 5;

/**
 * Cuts a chain of calls at the dots between them, whatever their arguments hold.
 *
 * @param chain - The chain, such as `getByRole("row", { name: "A. B" }).click()`.
 * @returns The calls, in order.
 */
export function chainCalls(chain: string): string[] {
  const calls: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let at = 0; at < chain.length; at += 1) {
    const char = chain[at]!;
    if (quote !== undefined) {
      if (char === "\\") at += 1;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === "." && depth === 0) {
      calls.push(chain.slice(start, at));
      start = at + 1;
    }
  }
  return [...calls, chain.slice(start)];
}

/** An element a call finds: what it is, the text that names it, and where that text is in the call. */
interface Found {
  readonly kind: string;
  readonly text: string;
  readonly call: string;
}

/** The element a call finds, when it is found by a text: by its role and name, or by the text the method is given. */
function found(call: string): Found | undefined {
  const match = FOUND.exec(call);
  if (match === null) return undefined;
  const [, method, first, rest] = match as unknown as [string, string, string, string];
  if (method !== "getByRole") return { kind: KINDS[method] ?? "element", text: first, call };
  const named = NAMED.exec(rest);
  return { kind: camelName(JSON.parse(first) as string, "element"), text: named?.[1] ?? "", call };
}

/**
 * The member of a page object a line of code acts on, when the line acts on an element found by its role,
 * its label or its text.
 *
 * @remarks
 * The member is named after the element the line acts on: its name, then what it is, such as `showButton`.
 * An element found within others, such as a button of a row, is a method given the name of each: which row
 * is a matter of the test, not of the screen. A line that opens an address, or acts in a way this does not
 * read, has no member: it stays as it is.
 *
 * @param code - The line, as a browser tool returned it.
 * @returns The member and what the line does on it; `undefined` for a line that stays as it is.
 */
export function memberAction(code: string): MemberAction | undefined {
  const calls = chainCalls(LINE.exec(code)?.[1] ?? "");
  const action = calls.pop()!;
  const elements = calls.map(found);
  if (elements.length === 0 || elements.includes(undefined)) return undefined;
  const chain = elements as Found[];
  const target = chain.at(-1)!;
  const within = chain.slice(0, -1);
  // An element the target is found within is given by the test when a text names it.
  const outer = within.filter((element) => element.text !== "");
  const parameters = outer.map((element, at) => (outer.findIndex((other) => other.kind === element.kind) === at ? element.kind : `${element.kind}${at + 1}`));
  const words = (target.text === "" ? "" : (JSON.parse(target.text) as string)).split(/[^a-zA-Z0-9]+/).filter((word) => word !== "");
  const base = camelName([...words.slice(0, MAX_WORDS), target.kind].join(" "), "element");
  const name = [base, ...within.toReversed().map((element) => `In${element.kind[0]!.toUpperCase()}${element.kind.slice(1)}`)].join("");
  const expression = chain
    .map((element) => (outer.includes(element) ? element.call.replace(element.text, parameters[outer.indexOf(element)]!) : element.call))
    .join(".");
  return { member: { name, parameters, expression }, given: outer.map((element) => element.text), action };
}
