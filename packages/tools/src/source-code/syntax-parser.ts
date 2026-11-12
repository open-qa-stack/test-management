import { createRequire } from "node:module";
import { extname } from "node:path";
import treeSitter from "@vscode/tree-sitter-wasm";
import type { Language, Tree } from "@vscode/tree-sitter-wasm";

const JAVASCRIPT = ["javascript", "tsx"];

/**
 * The grammars of each file extension, among those the tree-sitter build of VS Code provides, in the order
 * they are preferred: JavaScript files written with Flow or TypeScript annotations are read by the TSX
 * grammar when it makes fewer errors than the JavaScript one, and C files by the C++ grammar.
 */
const GRAMMARS: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ["cs", ["c-sharp"]],
  ["java", ["java"]],
  ...["js", "jsx", "mjs", "cjs"].map((extension) => [extension, JAVASCRIPT] as const),
  ...["ts", "mts", "cts"].map((extension) => [extension, ["typescript"]] as const),
  ["tsx", ["tsx"]],
  ["py", ["python"]],
  ["pyi", ["python"]],
  ["go", ["go"]],
  ["rs", ["rust"]],
  ["php", ["php"]],
  ["rb", ["ruby"]],
  ...["cpp", "cc", "cxx", "hpp", "hh", "hxx", "h", "c"].map((extension) => [extension, ["cpp"]] as const),
  ["sh", ["bash"]],
  ["bash", ["bash"]],
  ["ps1", ["powershell"]],
  ["psm1", ["powershell"]],
]);

/** Started once per process: two starts at the same time would create two WebAssembly modules. */
let ready: Promise<void> | undefined;
/** Loaded once per process and kept for its life, since a grammar cannot be unloaded from the module. */
const languages = new Map<string, Promise<Language>>();

/**
 * Tells which file extensions tree-sitter reads.
 *
 * @returns The extensions, without their dot.
 */
export function parsedExtensions(): string[] {
  return [...GRAMMARS.keys()];
}

/**
 * Parses a source file with tree-sitter, the parser editors use, in every language its grammars cover.
 *
 * @remarks
 * The WebAssembly module and each grammar are loaded on first use, once per process, and kept. The tree
 * lives in the memory of the module: the caller deletes it once read.
 *
 * @param path - Path of the file, whose extension gives its language.
 * @param text - Text of the file.
 * @returns Its syntax tree, by whichever of its grammars reads it with the fewest errors, the first one
 * on a tie; `undefined` when no grammar reads its language.
 * @throws Error when the WebAssembly module or a grammar cannot be loaded.
 */
export async function parseSource(path: string, text: string): Promise<Tree | undefined> {
  const grammars = GRAMMARS.get(extname(path).slice(1).toLowerCase());
  if (grammars === undefined) return undefined;
  const trees = await Promise.all(grammars.map((grammar) => parseWith(grammar, text)));
  const errors = trees.map((tree) => tree.rootNode.descendantsOfType("ERROR").length);
  const best = errors.indexOf(Math.min(...errors));
  trees.forEach((tree, i) => {
    if (i !== best) tree.delete();
  });
  return trees[best];
}

async function parseWith(grammar: string, text: string): Promise<Tree> {
  const language = await languageOf(grammar);
  const parser = new treeSitter.Parser();
  try {
    parser.setLanguage(language);
    // Tree-sitter returns no tree only for a parse cancelled from a progress callback, which this one never is.
    return parser.parse(text)!;
  } finally {
    parser.delete();
  }
}

function languageOf(grammar: string): Promise<Language> {
  ready ??= treeSitter.Parser.init();
  let language = languages.get(grammar);
  if (language === undefined) {
    const file = createRequire(import.meta.url).resolve(`@vscode/tree-sitter-wasm/wasm/tree-sitter-${grammar}.wasm`);
    language = ready.then(() => treeSitter.Language.load(file));
    languages.set(grammar, language);
  }
  return language;
}
