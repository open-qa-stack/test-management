import type { ReportedNode, Visitor } from "./rule.ts";

/** A call, as the visitor hands it. */
type Call = Parameters<NonNullable<Visitor["CallExpression"]>>[0];

/**
 * The string an argument always evaluates to: a string literal, or a template literal without substitution.
 *
 * @param node - The argument, if any.
 * @returns The string, or another value when the argument is not a constant string.
 */
function constant(node: Call["arguments"][number] | undefined): unknown {
  if (node?.type === "Literal") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked;
  return undefined;
}

/**
 * Tells whether a call loads or resolves a module the way CommonJS does: `require(…)`, `require.resolve(…)`, or
 * the same calls on the function `createRequire(…)` makes.
 *
 * @param callee - The function the call calls.
 */
function isRequire(callee: Call["callee"]): boolean {
  const loader = callee.type === "MemberExpression" && callee.property.type === "Identifier" && callee.property.name === "resolve" ? callee.object : callee;
  if (loader.type === "Identifier") return loader.name === "require";
  return loader.type === "CallExpression" && loader.callee.type === "Identifier" && loader.callee.name === "createRequire";
}

/**
 * The handlers that hand each module a file imports to a check, whatever the form of the import: a static or
 * type-only import, a re-export, a type query, an `import x = require(…)` declaration, or a dynamic import, a
 * `require(…)` or a `require.resolve(…)` of a constant string, `createRequire(…)(…)` included.
 *
 * @param check - Called with the node of the import and the specifier of the module.
 */
export function importVisitor(check: (node: ReportedNode, specifier: string) => void): Visitor {
  const visit = (node: ReportedNode, specifier: unknown): void => {
    if (typeof specifier === "string") check(node, specifier);
  };
  return {
    ImportDeclaration: (node) => visit(node, node.source.value),
    ExportNamedDeclaration: (node) => visit(node, node.source?.value),
    ExportAllDeclaration: (node) => visit(node, node.source.value),
    ImportExpression: (node) => visit(node, constant(node.source)),
    CallExpression: (node) => visit(node, isRequire(node.callee) ? constant(node.arguments[0]) : undefined),
    TSImportEqualsDeclaration: (node) =>
      visit(node, node.moduleReference.type === "TSExternalModuleReference" ? node.moduleReference.expression.value : undefined),
    TSImportType: (node) => visit(node, node.source.value),
  };
}
