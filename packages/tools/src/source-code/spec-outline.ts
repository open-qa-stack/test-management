import type { Node } from "@vscode/tree-sitter-wasm";

/** The methods of a page or a locator that locate an element by what the user perceives. */
const LOCATOR_METHODS = new Set(["getByRole", "getByText", "getByLabel", "getByPlaceholder", "getByTestId", "getByTitle", "getByAltText"]);
/** The methods of a locator that type or choose a value. */
const TYPING_METHODS = new Set(["fill", "type", "pressSequentially", "selectOption"]);

/** A locator a test uses, by role, text, label, placeholder, test id, title or alternative text. */
export interface SpecLocator {
  /** The call as the test writes it, from the name of the method, such as `getByRole("button", { name: "Save" })`. */
  readonly code: string;
  /** The role, for a locator by role. */
  readonly role?: string;
  /** The accessible name, the text, the label, the placeholder or the test id it looks for, when it is a string. */
  readonly text?: string;
}

/** A value a test types or chooses, written as a string. */
export interface SpecTyped {
  /** Its line, from 1. */
  readonly line: number;
  /** The value. */
  readonly text: string;
}

/** A `test.step` of a test that no other step holds. */
export interface SpecStep {
  /** Its title, when it is a string. */
  readonly title?: string;
  /** Where its call starts in the text. */
  readonly start: number;
  /** Where its call ends in the text. */
  readonly end: number;
}

/** An `expect` statement of a test. */
export interface SpecAssertion {
  /** The statement as the test writes it. */
  readonly code: string;
  /** Its line, from 1. */
  readonly line: number;
  /** Where it starts in the text. */
  readonly start: number;
  /** The texts the locators of its subject look for. */
  readonly located: readonly string[];
  /** Every string of its subject, the first argument of `expect`, such as the name of a locator; its message is left out. */
  readonly subject: readonly string[];
  /** Whether its subject chains `.or(…)`: it then holds when either element does. */
  readonly alternative: boolean;
  /** Every string its matcher is given, such as the text of `toContainText`. */
  readonly expected: readonly string[];
  /** The name of its matcher, such as `toBeVisible`. */
  readonly matcher: string;
  /** Whether it asserts that something is not so: `.not`, `toBeHidden` or `toHaveCount(0)`, one cancelling the other. */
  readonly negative: boolean;
}

/**
 * What a Playwright test holds, read once from its syntax tree: its tests, its steps, its locators, its
 * assertions and the values it types.
 *
 * @remarks
 * Only what is written as a string literal is read: a name, a text or a role given as a regular
 * expression, a variable or a template with substitutions is left out, for nothing can vouch for it. A
 * string is read without the escapes of its characters.
 */
export class SpecOutline {
  /** How many `test(…)` calls it holds. */
  public readonly tests: number;
  /** Its steps that no other step holds, in the order of the text. */
  public readonly steps: readonly SpecStep[];
  /** The locators, in the order of the text. */
  public readonly locators: readonly SpecLocator[];
  /** The `expect` statements, in the order of the text. */
  public readonly assertions: readonly SpecAssertion[];
  /** The values given as a string to `fill`, `type`, `pressSequentially` or `selectOption`, in the order of the text. */
  public readonly typed: readonly SpecTyped[];

  /** @param root - The root of the syntax tree of the test, which the outline reads whole and does not keep. */
  public constructor(root: Node) {
    const calls = root.descendantsOfType("call_expression").map((call) => call!);
    this.tests = calls.filter((call) => isIdentifier(call.childForFieldName("function")!, "test")).length;
    const steps = calls.filter(isStep);
    this.steps = steps.filter((step) => !steps.some((other) => other !== step && other.startIndex <= step.startIndex && step.endIndex <= other.endIndex)).map((step) => {
      const title = stringValue(step.childForFieldName("arguments")!.namedChildren[0]);
      return { ...(title === undefined ? {} : { title }), start: step.startIndex, end: step.endIndex };
    });
    this.locators = calls.flatMap((call) => locatorOf(call));
    this.assertions = root.descendantsOfType("expression_statement").flatMap((statement) => assertionOf(statement!));
    this.typed = calls.flatMap((call) => typedBy(call));
  }
}

/** The name of the method a call calls on an object, such as `click` in `button.click()`. */
function methodOf(call: Node): Node | undefined {
  const callee = call.childForFieldName("function")!;
  return callee.type === "member_expression" ? callee.childForFieldName("property")! : undefined;
}

/** Whether a node is the identifier of a name. */
function isIdentifier(node: Node, name: string): boolean {
  return node.type === "identifier" && node.text === name;
}

/** Whether a call is `test.step(…)`. */
function isStep(call: Node): boolean {
  const callee = call.childForFieldName("function")!;
  return callee.type === "member_expression" && isIdentifier(callee.childForFieldName("object")!, "test") && callee.childForFieldName("property")!.text === "step";
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

/** The value a call types, if it is one of the typing methods and its first argument is a string. */
function typedBy(call: Node): SpecTyped[] {
  const method = methodOf(call);
  if (method === undefined || !TYPING_METHODS.has(method.text)) return [];
  const text = stringValue(call.childForFieldName("arguments")!.namedChildren[0]);
  return text === undefined ? [] : [{ line: call.startPosition.row + 1, text }];
}

/** The assertion a statement is, if it is an `expect` statement, awaited or not, that ends with a matcher. */
function assertionOf(statement: Node): SpecAssertion[] {
  const expression = statement.namedChildren[0]!;
  const chain = expression.type === "await_expression" ? expression.namedChildren[0]! : expression;
  const subject = chain.type === "call_expression" ? expectCall(chain.childForFieldName("function")!) : undefined;
  const matcher = chain.type === "call_expression" ? methodOf(chain) : undefined;
  if (subject === undefined || matcher === undefined) return [];
  const target = subject.childForFieldName("arguments")!.namedChildren[0];
  const matcherArgs = chain.childForFieldName("arguments")!;
  const calls = target?.descendantsOfType("call_expression").map((call) => call!) ?? [];
  const located = calls.flatMap((call) => locatorOf(call).flatMap((locator) => (locator.text === undefined ? [] : [locator.text])));
  const first = matcherArgs.namedChildren[0];
  const hidden = matcher.text === "toBeHidden" || (matcher.text === "toHaveCount" && first?.type === "number" && Number(first.text) === 0);
  return [
    {
      code: statement.text,
      line: statement.startPosition.row + 1,
      start: statement.startIndex,
      located,
      subject: target ? strings(target) : [],
      alternative: calls.some((call) => methodOf(call)?.text === "or"),
      expected: strings(matcherArgs),
      matcher: matcher.text,
      negative: negated(chain.childForFieldName("function")!) !== hidden,
    },
  ];
}

/** The call of `expect` or `expect.soft` a chain of calls and members starts with, if it starts with one. */
function expectCall(node: Node): Node | undefined {
  if (node.type === "member_expression") return expectCall(node.childForFieldName("object")!);
  if (node.type !== "call_expression") return undefined;
  const callee = node.childForFieldName("function")!;
  if (isIdentifier(callee, "expect") || (callee.type === "member_expression" && isIdentifier(callee.childForFieldName("object")!, "expect"))) return node;
  return expectCall(callee);
}

/** Whether a chain of members, up to its call of `expect`, holds `.not`. */
function negated(node: Node): boolean {
  if (node.type !== "member_expression") return false;
  return node.childForFieldName("property")!.text === "not" || negated(node.childForFieldName("object")!);
}

/** The value of every string under a node, in the order of the text. */
function strings(node: Node): string[] {
  return node.descendantsOfType(["string", "template_string"]).flatMap((string) => {
    const value = stringValue(string);
    return value === undefined ? [] : [value];
  });
}

/** The value of a string literal or of a template without substitution; `undefined` for any other expression, or none. */
function stringValue(node: Node | null | undefined): string | undefined {
  if (node?.type !== "string" && (node?.type !== "template_string" || node.namedChildren.some((child) => child!.type === "template_substitution"))) return undefined;
  return node.text.slice(1, -1).replace(/\\(.)/g, "$1");
}
