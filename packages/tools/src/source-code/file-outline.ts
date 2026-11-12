import type { Node } from "@vscode/tree-sitter-wasm";
import { parseSource } from "./syntax-parser.ts";

/** Most symbols an outline gives. */
export const MAX_OUTLINE_SYMBOLS = 300;
/** Longest route given as it is written. */
const MAX_ROUTE_LENGTH = 200;

/** A declaration found in a file. */
export interface OutlineSymbol {
  /** Line of the declaration, from 1. */
  readonly line: number;
  /** `class`, `interface`, `enum`, `type`, `function`, `method` or `route`. */
  readonly kind: string;
  /** Name of the declaration; for a route, its annotation or its call as written. */
  readonly name: string;
}

/** The declarations of a file, and whether some were left out. */
export interface FileOutline {
  /** The declarations, in the order of the file. */
  readonly symbols: readonly OutlineSymbol[];
  /** Whether the file has more than `MAX_OUTLINE_SYMBOLS` declarations. */
  readonly truncated: boolean;
}

/** The kind of each declaration node, whatever the grammar. */
const DECLARATIONS: ReadonlyMap<string, string> = new Map([
  ...["class_declaration", "abstract_class_declaration", "class_definition", "class_specifier", "class", "class_statement", "record_declaration"].map((t) => [t, "class"] as const),
  ...["struct_declaration", "struct_item", "struct_specifier", "impl_item", "object_declaration", "module"].map((t) => [t, "class"] as const),
  ...["interface_declaration", "trait_declaration", "trait_item"].map((t) => [t, "interface"] as const),
  ...["enum_declaration", "enum_item", "enum_specifier"].map((t) => [t, "enum"] as const),
  ...["type_alias_declaration", "type_item"].map((t) => [t, "type"] as const),
  ...["function_declaration", "function_definition", "function_item", "generator_function_declaration", "function_statement", "method", "singleton_method"].map((t) => [t, "function"] as const),
  ...["method_declaration", "method_definition", "constructor_declaration", "method_signature", "abstract_method_signature", "method_elem", "class_method_definition", "function_signature_item"].map((t) => [t, "method"] as const),
]);

/** Declarations whose functions are methods. */
const CONTAINERS = new Set(["class", "interface"]);
/** C and C++ specifiers that only declare something when they have a body; otherwise they name a type. */
const SPECIFIERS = new Set(["class_specifier", "struct_specifier", "enum_specifier"]);
/** C++ declarators that wrap another one without naming it in a field. */
const WRAPPED_DECLARATORS = new Set(["reference_declarator", "parenthesized_declarator"]);
/** Nodes that name a declaration in grammars without a `name` field, such as PowerShell. */
const NAME_NODES = new Set(["function_name", "simple_name"]);
/** Values that make a variable, a field or an assignment hold a function. */
const FUNCTIONS = new Set(["arrow_function", "function_expression", "function"]);

/** Attributes, annotations and decorators, one each. */
const ANNOTATIONS = ["attribute", "annotation", "marker_annotation", "decorator"];
/** Nodes that hold annotations: C# and PHP attribute lists, Rust attributes, Java modifiers. */
const ANNOTATION_HOLDERS = new Set(["attribute_list", "attribute_group", "attribute_item", "modifiers"]);
/** Annotations that come before the declaration they annotate, as its siblings. */
const PRECEDING_ANNOTATIONS = new Set(["decorator", "attribute_item"]);
/**
 * Annotations that map a request to the code: ASP.NET, Spring, JAX-RS, NestJS, Symfony by their name;
 * FastAPI and Flask by an application method given a path; actix and rocket by a lower-case verb given a path.
 */
const ROUTE_ANNOTATION =
  /^@?(?:Http(?:Get|Post|Put|Delete|Patch|Head|Options)|AcceptVerbs|Route|RoutePrefix|(?:Get|Post|Put|Delete|Patch|Request)Mapping|GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|Path|Controller|Get|Post|Put|Delete|Patch|Head|Options|All)\b|^@?\w+\.(?:get|post|put|delete|patch|head|options|route|api_route|websocket)\s*\(\s*[rf]?["'](?:\/|["'])|^(?:get|post|put|delete|patch|head|options|route)\s*\(\s*"\//;

/** Calls, whatever the grammar. */
const CALLS = new Set(["call_expression", "invocation_expression", "method_invocation", "call", "member_call_expression", "scoped_call_expression"]);
/**
 * Calls that declare routes whatever their first argument: ASP.NET minimal APIs, Go net/http, gin and echo,
 * Django, Rails and Laravel resources.
 */
const ROUTE_CALLS = /^(?:Map(?:Get|Post|Put|Delete|Patch|Methods|Group|Fallback)?|HandleFunc|Handle|GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|Any|Group|path|re_path|resources|resource|apiResource)$/;
/** Calls that declare routes when given a path: Express, Fastify, Flask, Laravel, axum; and the Rails routing DSL. */
const ROUTE_VERBS = /^(?:get|post|put|delete|patch|head|options|all|route|use)$/;
/** First arguments that are literals: strings and symbols. */
const LITERAL = /string|symbol/;

/**
 * Lists the declarations of a source file, to find one's way in it without reading it whole.
 *
 * @remarks
 * The file is parsed by tree-sitter, so the outline holds in every language of its grammars: C#, Java,
 * JavaScript, TypeScript, Python, Go, Rust, PHP, Ruby, C++ (C included), Bash and PowerShell. Classes,
 * records, structures, interfaces, traits, enums and type aliases are given, then functions, and methods
 * within them; functions held by variables, class fields, assignments or wrapping calls count as such.
 * Routes are given too: the attributes, annotations and decorators that map a request to a declaration,
 * just before it, and the calls that declare one (ASP.NET minimal APIs, Express, Go, Django, Rails,
 * Laravel…). The tree is walked without recursion, so that deep code cannot exhaust the stack.
 *
 * @param path - Path of the file, whose extension gives its language.
 * @param text - Text of the file.
 * @returns The outline, or `undefined` when no grammar reads the language of the file.
 * @throws Error when tree-sitter or the grammar cannot be loaded.
 */
export async function fileOutline(path: string, text: string): Promise<FileOutline | undefined> {
  const tree = await parseSource(path, text);
  if (tree === undefined) return undefined;
  try {
    const symbols: OutlineSymbol[] = [];
    const pending: [Node, boolean][] = [[tree.rootNode, false]];
    while (pending.length > 0 && symbols.length <= MAX_OUTLINE_SYMBOLS) {
      const [node, inContainer] = pending.pop()!;
      const route = routeCall(node);
      const declared = declaration(node, inContainer);
      if (route !== undefined) symbols.push(route);
      if (declared !== undefined) symbols.push(...routeAnnotations(node), declared);
      const nested = declared === undefined ? inContainer : CONTAINERS.has(declared.kind);
      const children = node.namedChildren;
      for (let i = children.length - 1; i >= 0; i--) pending.push([children[i]!, nested]);
    }
    const kept = symbols.slice(0, MAX_OUTLINE_SYMBOLS).sort((a, b) => a.line - b.line);
    return { symbols: kept, truncated: symbols.length > MAX_OUTLINE_SYMBOLS };
  } finally {
    tree.delete();
  }
}

/** The declaration a node is, if any, on the line of its name rather than of its annotations. */
function declaration(node: Node, inContainer: boolean): OutlineSymbol | undefined {
  const held = heldFunction(node);
  if (held !== undefined) return { line: held.startPosition.row + 1, kind: inContainer ? "method" : "function", name: held.text };
  const kind = node.type === "type_spec" ? goTypeKind(node) : DECLARATIONS.get(node.type);
  if (kind === undefined || (SPECIFIERS.has(node.type) && node.childForFieldName("body") === null)) return undefined;
  const name = nameOf(node);
  if (name === undefined) return undefined;
  const method = inContainer || name.node.type === "qualified_identifier";
  return { line: name.node.startPosition.row + 1, kind: kind === "function" && method ? "method" : kind, name: name.text };
}

/**
 * The name of a variable, a class field or an assignment that holds a function: `const save = () => {}`,
 * `const Card = memo(function Card() {})`, `module.exports.handler = async function () {}`.
 */
function heldFunction(node: Node): Node | undefined {
  const [name, value] =
    node.type === "assignment_expression"
      ? [node.childForFieldName("left"), node.childForFieldName("right")]
      : ["variable_declarator", "public_field_definition", "field_definition"].includes(node.type)
        ? [node.childForFieldName(node.type === "field_definition" ? "property" : "name"), node.childForFieldName("value")]
        : [null, null];
  if (name === null || value === null) return undefined;
  const wrapped = value.type === "call_expression" ? value.childForFieldName("arguments")?.lastNamedChild : value;
  return wrapped != null && FUNCTIONS.has(wrapped.type) ? name : undefined;
}

/** In Go, `type X struct` is a class, `type X interface` an interface, any other `type X …` a type. */
function goTypeKind(node: Node): string {
  const type = node.childForFieldName("type")?.type;
  return type === "struct_type" ? "class" : type === "interface_type" ? "interface" : "type";
}

/**
 * The name of a declaration: its `name`, `Trait for Type` for a Rust `impl`, the innermost name of a C++
 * declarator, or a child that names it; none for a TypeScript `declare module "x"`.
 */
function nameOf(node: Node): { readonly node: Node; readonly text: string } | undefined {
  if (node.type === "impl_item") {
    const type = node.childForFieldName("type")!;
    const trait = node.childForFieldName("trait");
    return { node: type, text: trait === null ? type.text : `${trait.text} for ${type.text}` };
  }
  const name = node.childForFieldName("name");
  if (name !== null) return name.type === "string" ? undefined : { node: name, text: name.text };
  let declarator = node.childForFieldName("declarator");
  for (let inner = declarator; inner !== null; inner = inner.childForFieldName("declarator") ?? (WRAPPED_DECLARATORS.has(inner.type) ? inner.firstNamedChild : null)) {
    declarator = inner;
  }
  const named = declarator ?? node.namedChildren.find((child) => NAME_NODES.has(child!.type)) ?? null;
  return named === null ? undefined : { node: named, text: named.text };
}

/** The annotations of a declaration that map routes: among its children and its modifiers, and around it. */
function routeAnnotations(node: Node): OutlineSymbol[] {
  const around: Node[] = [];
  for (let sibling = node.previousNamedSibling; sibling !== null && PRECEDING_ANNOTATIONS.has(sibling.type); sibling = sibling.previousNamedSibling) around.unshift(sibling);
  if (node.parent?.type === "decorated_definition") around.push(...node.parent.namedChildren.map((child) => child!));
  const annotations = [...around, ...node.namedChildren.map((child) => child!)].flatMap((candidate) =>
    ANNOTATION_HOLDERS.has(candidate.type) ? candidate.descendantsOfType(ANNOTATIONS).map((d) => d!) : ANNOTATIONS.includes(candidate.type) ? [candidate] : [],
  );
  const unique = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  return [...unique.values()].filter((annotation) => ROUTE_ANNOTATION.test(annotation.text)).map((annotation) => routeSymbol(annotation, annotation.text));
}

/**
 * The route a call declares, if it is one: `app.MapGet("/orders/{id}", …)`, `router.get("/x", …)`… A call
 * that is a decorator is given as that decorator.
 */
function routeCall(node: Node): OutlineSymbol | undefined {
  if (!CALLS.has(node.type) || node.parent?.type === "decorator") return undefined;
  // Every grammar names the callee of its calls, by one of these fields.
  const callee = (node.childForFieldName("function") ?? node.childForFieldName("name") ?? node.childForFieldName("method"))!;
  const verb = /(\w*)\W*$/.exec(callee.text)![1]!;
  const args = node.childForFieldName("arguments");
  const argument = args?.firstNamedChild;
  const first = argument?.type === "argument" ? argument.firstNamedChild : argument;
  if (first == null || !LITERAL.test(first.type)) return undefined;
  const dsl = node.type === "call" && node.childForFieldName("method") !== null && node.childForFieldName("receiver") === null;
  const declares = ROUTE_CALLS.test(verb) || (ROUTE_VERBS.test(verb) && (dsl || /^[@$]?[rbfu]*["'`]\//.test(first.text)));
  const called = node.text.slice(0, args!.startIndex - node.startIndex).trim();
  return declares ? routeSymbol(node, `${called}(${first.text}${args!.namedChildCount > 1 ? ", …" : ""})`) : undefined;
}

function routeSymbol(node: Node, text: string): OutlineSymbol {
  const flat = text.replace(/\s+/g, " ").trim();
  return { line: node.startPosition.row + 1, kind: "route", name: flat.length > MAX_ROUTE_LENGTH ? `${flat.slice(0, MAX_ROUTE_LENGTH)}…` : flat };
}
