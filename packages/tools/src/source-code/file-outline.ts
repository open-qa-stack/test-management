import { fileLines } from "./text-search.ts";

/** Most symbols an outline gives. */
export const MAX_OUTLINE_SYMBOLS = 300;
/** Longest line looked at; a declaration is never longer, and longer lines would only cost time. */
export const MAX_OUTLINE_LINE_LENGTH = 300;

/** The declarations of a file, and whether some were left out. */
export interface FileOutline {
  /** The declarations, in the order of the file. */
  readonly symbols: readonly OutlineSymbol[];
  /** Whether the file has more than `MAX_OUTLINE_SYMBOLS` declarations. */
  readonly truncated: boolean;
}

/** A declaration found in a file. */
export interface OutlineSymbol {
  /** Line of the declaration, from 1. */
  readonly line: number;
  /** `class`, `interface`, `enum`, `type`, `function`, `method` or `route`. */
  readonly kind: string;
  /** Name of the class, function or method; for a route, its annotation as written. */
  readonly name: string;
}

/** A pattern that finds one kind of declaration on a line; the name is its first capture. */
interface Declaration {
  readonly kind: string;
  readonly pattern: RegExp;
}

/** Words that open a block like a method declaration does, and are not methods. */
const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "new", "else", "do", "try", "synchronized", "throw", "super", "this"]);

const TYPESCRIPT: readonly Declaration[] = [
  { kind: "class", pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([\w$]+)/ },
  { kind: "interface", pattern: /^\s*(?:export\s+)?interface\s+([\w$]+)/ },
  { kind: "enum", pattern: /^\s*(?:export\s+)?(?:const\s+)?enum\s+([\w$]+)/ },
  { kind: "type", pattern: /^\s*(?:export\s+)?type\s+([\w$]+)\s*(?:<[^=]*>)?\s*=/ },
  { kind: "function", pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/ },
  { kind: "function", pattern: /^\s*(?:export\s+)?(?:const|let)\s+([\w$]+)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[\w$]+)\s*(?::[^=]+)?=>/ },
  { kind: "method", pattern: /^[ \t]+(?:(?:public|private|protected|static|readonly|async|override|abstract|get|set) +)*#?([\w$]+) *(?:<[^>()]*>)?\([^()]*\) *(?:: *[^{};=]+)?\{ *\}? *$/ },
  { kind: "method", pattern: /^[ \t]+(?:(?:public|private|protected|static|readonly|override) +)*#?([\w$]+) *(?::[^=]+)?= *(?:async +)?(?:\([^()]*\)|[\w$]+) *(?::[^=]+)?=>/ },
];

const JAVA: readonly Declaration[] = [
  { kind: "route", pattern: /^\s*(@(?:Get|Post|Put|Delete|Patch|Request)Mapping\b.*)$/ },
  { kind: "class", pattern: /^\s*(?:(?:public|protected|private|abstract|final|static|sealed)\s+)*class\s+(\w+)/ },
  { kind: "interface", pattern: /^\s*(?:(?:public|protected|private|static)\s+)*@?interface\s+(\w+)/ },
  { kind: "enum", pattern: /^\s*(?:(?:public|protected|private|static)\s+)*enum\s+(\w+)/ },
  { kind: "class", pattern: /^\s*(?:(?:public|protected|private|static|final)\s+)*record\s+(\w+)/ },
  { kind: "method", pattern: /^[ \t]+(?!(?:return|throw|new|else|case)\b)(?:(?:public|protected|private|static|final|abstract|synchronized|default|native) +)*(?:<[^<>]+> +)?[\w.[\]?]+(?:<[\w.[\]?, <>]*>)?(?:\[\])* +(\w+) *\(/ },
];

const LANGUAGES: Readonly<Record<string, readonly Declaration[]>> = {
  ts: TYPESCRIPT, tsx: TYPESCRIPT, mts: TYPESCRIPT, cts: TYPESCRIPT, js: TYPESCRIPT, jsx: TYPESCRIPT, mjs: TYPESCRIPT, cjs: TYPESCRIPT,
  java: JAVA,
};

/**
 * Lists the declarations of a source file, to find one's way in it without reading it whole.
 *
 * @remarks
 * The outline is read line by line with patterns, not parsed: it finds the classes, interfaces, enums,
 * types, functions and methods of TypeScript and JavaScript files, and the classes, interfaces, enums,
 * records, methods and Spring route annotations of Java files. A declaration written over several lines
 * may be missed, and lines longer than `MAX_OUTLINE_LINE_LENGTH` are not looked at; reading the file
 * settles any doubt. The patterns do not backtrack beyond the length of a line.
 *
 * @param path - Path of the file, whose extension gives its language.
 * @param text - Text of the file.
 * @returns The declarations in the order of the file, or `undefined` when the language is not supported.
 */
export function fileOutline(path: string, text: string): FileOutline | undefined {
  const declarations = LANGUAGES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
  if (declarations === undefined) return undefined;
  const symbols: OutlineSymbol[] = [];
  fileLines(text).forEach((line, i) => {
    if (line.length > MAX_OUTLINE_LINE_LENGTH) return;
    for (const { kind, pattern } of declarations) {
      const name = pattern.exec(line)?.[1];
      if (name !== undefined && !KEYWORDS.has(name)) {
        symbols.push({ line: i + 1, kind, name: name.trim() });
        break;
      }
    }
  });
  return { symbols: symbols.slice(0, MAX_OUTLINE_SYMBOLS), truncated: symbols.length > MAX_OUTLINE_SYMBOLS };
}
