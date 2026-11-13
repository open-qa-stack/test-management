import type { Node } from "@vscode/tree-sitter-wasm";

/** The methods of a page or a locator that locate an element by what the user perceives. */
const LOCATOR_METHODS = new Set(["getByRole", "getByText", "getByLabel", "getByPlaceholder", "getByTestId", "getByTitle", "getByAltText"]);
/** The methods that navigate, enter something, or send a request to an API. */
const ACTION_METHODS = new Set(["goto", "click", "dblclick", "fill", "press", "type", "check", "uncheck", "selectOption", "setInputFiles", "get", "post", "put", "patch", "delete", "fetch"]);
/** The matchers whose first argument is a text the element must hold. */
const TEXT_MATCHERS = new Set(["toHaveText", "toContainText", "toHaveValue"]);

/** A locator a test uses, by role, text, label, placeholder, test id, title or alternative text. */
export interface SpecLocator {
  /** The call as the test writes it, from the name of the method, such as `getByRole("button", { name: "Save" })`. */
  readonly code: string;
  /** The role, for a locator by role. */
  readonly role?: string;
  /** The accessible name, the text, the label, the placeholder or the test id it looks for, when it is a string. */
  readonly text?: string;
}

/** An `expect` statement of a test. */
export interface SpecAssertion {
  /** The statement as the test writes it. */
  readonly code: string;
  /** Where it starts in the text, to tell what comes before it. */
  readonly start: number;
  /** The texts it names: those its locators look for, then those its matcher expects. */
  readonly texts: readonly string[];
}

/**
 * What a Playwright test holds, read once from its syntax tree: its locators, its assertions and where its
 * actions are.
 *
 * @remarks
 * Only what is written as a string literal is read: a name, a text or a role given as a regular
 * expression, a variable or a template with substitutions is left out, for nothing can vouch for it. A
 * string is read without the escapes of its characters.
 */
export class SpecOutline {
  /** The locators, in the order of the text. */
  public readonly locators: readonly SpecLocator[];
  /** The `expect` statements, in the order of the text. */
  public readonly assertions: readonly SpecAssertion[];
  readonly #actions: readonly number[];

  /** @param root - The root of the syntax tree of the test, which the outline reads whole and does not keep. */
  public constructor(root: Node) {
    const calls = root.descendantsOfType("call_expression").map((call) => call!);
    this.locators = calls.flatMap((call) => locatorOf(call));
    this.#actions = calls.flatMap((call) => {
      const method = methodOf(call);
      return method !== undefined && ACTION_METHODS.has(method.text) ? [method.startIndex] : [];
    });
    this.assertions = root.descendantsOfType("expression_statement").flatMap((statement) => assertionOf(statement!));
  }

  /**
   * Whether an action — a navigation, an input or a request — comes before a point of the text.
   *
   * @param start - Where in the text, as `SpecAssertion.start` gives it.
   * @returns `true` when one does.
   */
  public actsBefore(start: number): boolean {
    return this.#actions.some((at) => at < start);
  }
}

/** The name of the method a call calls on an object, such as `click` in `button.click()`. */
function methodOf(call: Node): Node | undefined {
  const callee = call.childForFieldName("function")!;
  return callee.type === "member_expression" ? callee.childForFieldName("property")! : undefined;
}

/** The locator a call is, if it is one whose first argument is a string. */
function locatorOf(call: Node): SpecLocator[] {
  const method = methodOf(call);
  if (method === undefined || !LOCATOR_METHODS.has(method.text)) return [];
  const args = call.childForFieldName("arguments")!;
  const [first, options] = args.namedChildren;
  const value = stringValue(first);
  if (value === undefined) return [];
  const code = `${method.text}${args.text}`;
  if (method.text !== "getByRole") return [{ code, text: value }];
  const name = options?.type === "object" ? options.namedChildren.find((pair) => pair!.type === "pair" && pair!.childForFieldName("key")!.text === "name") : undefined;
  const text = stringValue(name?.childForFieldName("value"));
  return [{ code, role: value, ...(text === undefined ? {} : { text }) }];
}

/** The assertion a statement is, if it is an `expect` statement, awaited or not. */
function assertionOf(statement: Node): SpecAssertion[] {
  const expression = statement.namedChildren[0]!;
  const chain = expression.type === "await_expression" ? expression.namedChildren[0]! : expression;
  if (chain.type !== "call_expression" || !startsWithExpect(chain)) return [];
  const located = statement.descendantsOfType("call_expression").flatMap((call) => locatorOf(call!).flatMap((locator) => (locator.text === undefined ? [] : [locator.text])));
  const matcher = methodOf(chain);
  const expected = matcher !== undefined && TEXT_MATCHERS.has(matcher.text) ? stringValue(chain.childForFieldName("arguments")!.namedChildren[0]) : undefined;
  return [{ code: statement.text, start: statement.startIndex, texts: [...located, ...(expected === undefined ? [] : [expected])] }];
}

/** Whether a chain of calls starts with `expect`, such as `expect(total).not.toHaveText("0")` or `expect.soft(total)`. */
function startsWithExpect(node: Node): boolean {
  if (node.type === "call_expression") return startsWithExpect(node.childForFieldName("function")!);
  if (node.type === "member_expression") return startsWithExpect(node.childForFieldName("object")!);
  return node.type === "identifier" && node.text === "expect";
}

/** The value of a string literal or of a template without substitution; `undefined` for any other expression, or none. */
function stringValue(node: Node | null | undefined): string | undefined {
  if (node?.type !== "string" && (node?.type !== "template_string" || node.namedChildren.some((child) => child!.type === "template_substitution"))) return undefined;
  return node.text.slice(1, -1).replace(/\\(.)/g, "$1");
}
