import { createHash } from "node:crypto";
import type { Node } from "@vscode/tree-sitter-wasm";
import { parseSource } from "./syntax-parser.ts";

/** The modifiers of a call of `test` that still declare a test, such as `test.only("…", …)`. */
const TEST_MODIFIERS = new Set(["only", "skip", "fixme", "fail", "slow"]);

/** The tokens that only separate or end what they follow: a code with them or without them does the same. */
const SEPARATORS = new Set([";", ","]);

/** What a call of `test` declares: a group of tests under a title, a test, or a group whose title cannot be read, whose tests cannot be named. */
type Declared = { readonly kind: "describe" | "test"; readonly title: string } | { readonly kind: "unnamed" };

/** Whether a node says something of what the code does: neither a comment nor a separator. */
function significant(node: Node): boolean {
  return node.type !== "comment" && (node.isNamed || !SEPARATORS.has(node.type));
}

/** A node as plain data, without its layout: its kind and its parts, a string by its value whatever its quotes. */
function bare(node: Node): unknown {
  if (node.type === "string") return [node.type, stringValue(node)];
  if (node.childCount === 0) return [node.type, node.text];
  return [node.type, ...node.children.filter((child) => significant(child!)).map((child) => bare(child!))];
}

/** The value of a string literal or of a template without substitution, its quotes and escapes taken away. */
export function stringValue(node: Node): string {
  return node.text.slice(1, -1).replace(/\\(.)/g, "$1");
}

/** The names of a callee written as a chain, such as `["test", "describe", "serial"]`; none for another callee. */
export function chain(callee: Node): string[] {
  if (callee.type === "identifier") return [callee.text];
  if (callee.type !== "member_expression") return [];
  const head = chain(callee.childForFieldName("object")!);
  return head.length === 0 ? [] : [...head, callee.childForFieldName("property")!.text];
}

/** The text a title is written as, a string literal or a template without substitution; `undefined` for another one. */
export function titleOf(argument: Node | null | undefined): string | undefined {
  if (argument?.type === "string") return stringValue(argument);
  if (argument?.type === "template_string" && !argument.namedChildren.some((child) => child!.type === "template_substitution")) return stringValue(argument);
  return undefined;
}

/** Whether an argument is a function written in place. */
function isFunction(argument: Node | undefined): boolean {
  return argument?.type === "arrow_function" || argument?.type === "function_expression";
}

/** What a call declares, when it is a call of `test`. */
function declared(call: Node): Declared | undefined {
  const [head, ...modifiers] = chain(call.childForFieldName("function")!);
  if (head !== "test") return undefined;
  // Every call has its arguments, a tagged template its template, which holds no title.
  const args = call.childForFieldName("arguments")!.namedChildren.map((child) => child!);
  const title = titleOf(args[0]);
  if (modifiers[0] === "describe") {
    if (title !== undefined) return { kind: "describe", title };
    // An anonymous group still holds its tests, under an empty title, as the runner reports them.
    if (isFunction(args[0])) return { kind: "describe", title: "" };
    return args.some(isFunction) ? { kind: "unnamed" } : undefined;
  }
  if (modifiers.length > 1 || (modifiers.length === 1 && !TEST_MODIFIERS.has(modifiers[0]!)) || title === undefined) return undefined;
  return { kind: "test", title };
}

/** A test a file declares, as the walk finds it: its titles, and its call of `test`. */
export interface Found {
  readonly title: string;
  readonly call: Node;
}

/** Finds the tests under a node, each with the titles of the groups that hold it. */
function walk(node: Node, titles: readonly string[], found: Found[]): void {
  const call = node.type === "call_expression" ? declared(node) : undefined;
  if (call?.kind === "unnamed") return;
  if (call?.kind === "test") {
    found.push({ title: [...titles, call.title].join(" › "), call: node });
    return;
  }
  const inner = call === undefined ? titles : [...titles, call.title];
  for (const child of node.namedChildren) walk(child!, inner, found);
}

/** A test a file of tests declares, as the runner names it, with what its call says of it. */
export interface DeclaredTest {
  /** Its titles, those of the groups `test.describe` that hold it then its own, as `<describe>… › <title>`. */
  readonly title: string;
  /** The SHA-256 of its call of `test`, read as code without its comments nor its layout, in hexadecimal. */
  readonly digest: string;
  /** Its tags, as its details give them: `{ tag: "@a" }` or `{ tag: ["@a", "@b"] }`. */
  readonly tags: readonly string[];
  /** The titles of the steps `test.step(…)` of its body, in order. */
  readonly steps: readonly string[];
}

/** What a file of tests declares: its tests, those whose titles another of the file already has, and whether it could be read whole. */
export interface TestDeclarations {
  /** Its tests, in the order of the file, the first of a name counting. */
  readonly tests: readonly DeclaredTest[];
  /** The titles a test of the file has once more, each once. */
  readonly duplicates: readonly string[];
  /** Whether the file holds a syntax error: none of its tests is then read. */
  readonly unreadable: boolean;
}

/**
 * The tests a tree of a file of tests declares, in the order of the file, a title given twice once each time.
 *
 * @param root - The root of the tree.
 * @returns Each test, by its titles, with its call of `test`.
 */
export function foundTests(root: Node): Found[] {
  const found: Found[] = [];
  walk(root, [], found);
  return found;
}

/** The details of a call of `test`, the object after its title, if it has one. */
export function detailsOf(call: Node): Node | undefined {
  return call
    .childForFieldName("arguments")!
    .namedChildren.map((child) => child!)
    .find((child) => child.type === "object");
}

/** The pair `tag` of the details of a call of `test`, if they have one. */
export function tagPairOf(call: Node): Node | undefined {
  return detailsOf(call)
    ?.namedChildren.map((pair) => pair!)
    .find((pair) => pair.type === "pair" && pair.childForFieldName("key")!.text === "tag");
}

/** The tags of the details of a call of `test`. */
function tagsOf(call: Node): string[] {
  const value = tagPairOf(call)?.childForFieldName("value");
  if (value?.type === "string") return [stringValue(value)];
  return value?.type === "array" ? value.namedChildren.filter((item) => item!.type === "string").map((item) => stringValue(item!)) : [];
}

/** The titles of the steps of a call of `test`, in order: each the literal it is written as. */
export function stepTitlesOf(node: Node): Node[] {
  const argument =
    node.type === "call_expression" && chain(node.childForFieldName("function")!).join(".") === "test.step"
      ? node.childForFieldName("arguments")!.namedChildren[0]
      : undefined;
  const own = titleOf(argument) === undefined ? [] : [argument!];
  return [...own, ...node.namedChildren.flatMap((child) => stepTitlesOf(child!))];
}

/** The titles of the steps of a call of `test`, in order. */
function stepsOf(node: Node): string[] {
  return stepTitlesOf(node).map((title) => titleOf(title)!);
}

/**
 * The tests a file of tests declares, each named as the runner reports it, with its digest, its tags and its steps.
 *
 * @remarks
 * A test is named by its titles, those of the groups `test.describe` that hold it then its own, as `<describe>… ›
 * <title>`. A test whose title is no plain text, such as one built in a loop, has none, and is not declared. Two tests
 * of one name are one test for the runner and for what keeps their results: the first counts, and the name is told as a
 * duplicate.
 *
 * @param text - The text of the file, in TypeScript.
 * @returns Its tests, its duplicate titles, and whether it holds a syntax error.
 * @throws Error when the grammar cannot be loaded.
 */
export async function declaredTests(text: string): Promise<TestDeclarations> {
  // The extension picks the TypeScript grammar, which always exists.
  const tree = (await parseSource("tests.ts", text))!;
  try {
    if (tree.rootNode.hasError) return { tests: [], duplicates: [], unreadable: true };
    const found = foundTests(tree.rootNode);
    const tests = new Map<string, DeclaredTest>();
    const duplicates = new Set<string>();
    for (const { title, call } of found) {
      if (tests.has(title)) duplicates.add(title);
      else
        tests.set(title, {
          title,
          digest: createHash("sha256")
            .update(JSON.stringify(bare(call)))
            .digest("hex"),
          tags: tagsOf(call),
          steps: stepsOf(call),
        });
    }
    return { tests: [...tests.values()], duplicates: [...duplicates], unreadable: false };
  } finally {
    tree.delete();
  }
}

/**
 * The digest of each test a file of tests declares: the SHA-256 of its call of `test` — its title, its details and its
 * body — read as code without its comments nor its layout — spaces, line breaks, quotes, semicolons, trailing commas —
 * so that a comment or a formatting changes nothing of it, nor does a change to another test of the file.
 *
 * @remarks
 * A test is named by its titles, those of the groups `test.describe` that hold it then its own, as `<describe>… ›
 * <title>`, the first of a name counting. A test whose title is no plain text, such as one built in a loop, has none.
 *
 * @param text - The text of the file, in TypeScript.
 * @returns The digest of each test, in hexadecimal, by its titles; none for a text with a syntax error.
 * @throws Error when the grammar cannot be loaded.
 */
export async function testDigests(text: string): Promise<Map<string, string>> {
  return new Map((await declaredTests(text)).tests.map(({ title, digest }) => [title, digest]));
}
