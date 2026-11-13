import type { Node } from "@vscode/tree-sitter-wasm";
import { parseSource } from "./syntax-parser.ts";

/** A module a TypeScript file imports, re-exports or requires. */
export interface ModuleImport {
  /** The module as written; `undefined` when its name is computed at run time. */
  readonly module: string | undefined;
  /** Line of the import, from 1. */
  readonly line: number;
}

/** What the syntax of a TypeScript file tells: its first error, or the modules it imports. */
export type ModuleSyntax = { readonly ok: true; readonly imports: readonly ModuleImport[] } | { readonly ok: false; readonly error: string };

/** Longest excerpt of the text an error quotes. */
const MAX_EXCERPT = 40;

/**
 * Parses a file as TypeScript, with the grammar the source code tools use.
 *
 * @remarks
 * The imports are those of `import` and `export … from` statements, of `import x = require(…)`, and of
 * `import(…)` and `require(…)` calls, in the order of the file.
 *
 * @param text - Text of the file.
 * @returns Its first syntax error, by line and column, or every module it imports.
 * @throws Error when the grammar cannot be loaded.
 */
export async function moduleSyntax(text: string): Promise<ModuleSyntax> {
  // The extension picks the TypeScript grammar, which always exists.
  const tree = (await parseSource("module.ts", text))!;
  try {
    const root = tree.rootNode;
    if (root.hasError) return { ok: false, error: describeError(firstError(root)) };
    return { ok: true, imports: importsOf(root) };
  } finally {
    tree.delete();
  }
}

/** The first node, in the order of the file, that is an error or a missing token. */
function firstError(node: Node): Node {
  if (node.isError || node.isMissing) return node;
  // A node with an error that is neither one has a child with an error.
  return firstError(node.children.find((child) => child!.hasError)!);
}

function describeError(node: Node): string {
  const where = `line ${node.startPosition.row + 1}, column ${node.startPosition.column + 1}`;
  if (node.isMissing) return `${where}: missing ${JSON.stringify(node.type)}`;
  const excerpt = node.text.split("\n")[0]!.slice(0, MAX_EXCERPT);
  return `${where}: unexpected ${JSON.stringify(excerpt)}`;
}

function importsOf(root: Node): ModuleImport[] {
  const found: ModuleImport[] = [];
  const visit = (node: Node): void => {
    const source = node.type === "import_statement" || node.type === "export_statement" || node.type === "import_require_clause" ? node.childForFieldName("source") : null;
    if (source !== null) found.push({ module: literal(source), line: source.startPosition.row + 1 });
    if (node.type === "call_expression" && isImportCall(node.childForFieldName("function")!)) {
      found.push({ module: literal(node.childForFieldName("arguments")!.namedChildren[0]), line: node.startPosition.row + 1 });
    }
    for (const child of node.namedChildren) visit(child!);
  };
  visit(root);
  return found;
}

function isImportCall(callee: Node): boolean {
  return callee.type === "import" || (callee.type === "identifier" && callee.text === "require");
}

/** The text of a string literal; `undefined` for any other expression, or none. */
function literal(node: Node | null | undefined): string | undefined {
  return node?.type === "string" ? node.text.slice(1, -1) : undefined;
}
