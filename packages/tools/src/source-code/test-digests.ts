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

/** The value of a string literal, its quotes and escapes taken away. */
function stringValue(node: Node): string {
  return node.text.slice(1, -1).replace(/\\(.)/g, "$1");
}

/** The names of a callee written as a chain, such as `["test", "describe", "serial"]`; none for another callee. */
function chain(callee: Node): string[] {
  if (callee.type === "identifier") return [callee.text];
  if (callee.type !== "member_expression") return [];
  const head = chain(callee.childForFieldName("object")!);
  return head.length === 0 ? [] : [...head, callee.childForFieldName("property")!.text];
}

/** The text a title is written as, a string literal or a template without substitution; `undefined` for another one. */
function titleOf(argument: Node | undefined): string | undefined {
  if (argument?.type === "string") return stringValue(argument);
  if (argument?.type === "template_string" && !argument.namedChildren.some((child) => child!.type === "template_substitution"))
    return argument.text.slice(1, -1);
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

/** The digest of each test under a node, by its titles, as the groups that hold it give them. */
function walk(node: Node, titles: readonly string[], digests: Map<string, string>): void {
  const call = node.type === "call_expression" ? declared(node) : undefined;
  if (call?.kind === "unnamed") return;
  if (call?.kind === "test") {
    const title = [...titles, call.title].join(" › ");
    if (!digests.has(title))
      digests.set(
        title,
        createHash("sha256")
          .update(JSON.stringify(bare(node)))
          .digest("hex"),
      );
    return;
  }
  const inner = call === undefined ? titles : [...titles, call.title];
  for (const child of node.namedChildren) walk(child!, inner, digests);
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
  // The extension picks the TypeScript grammar, which always exists.
  const tree = (await parseSource("tests.ts", text))!;
  try {
    const digests = new Map<string, string>();
    if (!tree.rootNode.hasError) walk(tree.rootNode, [], digests);
    return digests;
  } finally {
    tree.delete();
  }
}
