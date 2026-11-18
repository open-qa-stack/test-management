import type { SourceExport } from "@open-qa-stack/tools";

const NAME = "[A-Za-z_][A-Za-z0-9_$]*";
const WORDS = new RegExp(NAME, "g");
const DOTTED = new RegExp(`${NAME}(?:\\.${NAME})+`, "g");
/** A lone name of several words joined by underscores, as columns and tables are often named. */
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;
/** A fenced block of code, its text in the first group; the info string of a fence holds no backtick. */
const FENCED = /```[^`\n]*\n([\s\S]*?)```/g;

/** What the export of a source names, to tell a name a domain file cites from one it invents. */
export interface ExportVocabulary {
  /** Identifier of the source. */
  readonly sourceId: string;
  /** The first part of the names of the elements: the schemas of a database. */
  readonly schemas: ReadonlySet<string>;
  /** Every word of the names, summaries and definitions of the elements. */
  readonly words: ReadonlySet<string>;
  /** Every name in two parts or more written in them, and each of its beginnings. */
  readonly dotted: ReadonlySet<string>;
  /** The names each relation declares, by its name and by its name without its schema; a routine declares none here. */
  readonly columns: ReadonlyMap<string, readonly string[]>;
  /** The names of the elements, by their name without their schema. */
  readonly elements: ReadonlyMap<string, readonly string[]>;
}

/**
 * The way a name is written in the citation of an element with arguments: without them.
 *
 * @param name - Name of an element.
 * @returns The name up to its opening parenthesis; the whole name when it has none.
 */
export function shortName(name: string): string {
  const open = name.indexOf("(");
  return open === -1 ? name : name.slice(0, open);
}

/**
 * Whether a text cites an element: its name between backticks, exactly as the source gives it or, for an
 * element with arguments such as a routine, without them, with or without empty parentheses.
 *
 * @param text - A markdown text.
 * @param name - Name of the element.
 * @returns Whether the text cites it.
 */
export function cites(text: string, name: string): boolean {
  const short = shortName(name);
  return [name, short, `${short}()`].some((form) => text.includes(`\`${form}\``));
}

/**
 * Reads what the export of a source names. Names are compared without their case nor their double quotes.
 *
 * @param sourceId - Identifier of the source.
 * @param exported - Its export.
 * @returns Its vocabulary.
 */
export function exportVocabulary(sourceId: string, exported: SourceExport): ExportVocabulary {
  const text = plain(exported.elements.map((element) => `${element.name}\n${element.summary}\n${element.definition}`).join("\n"));
  const dotted = new Set((text.match(DOTTED) ?? []).flatMap((name) => beginnings(name)));
  const columns = new Map<string, string[]>();
  const elements = new Map<string, string[]>();
  for (const element of exported.elements) {
    const short = plain(shortName(element.name));
    const bare = short.slice(short.indexOf(".") + 1);
    elements.set(bare, [...(elements.get(bare) ?? []), element.name]);
    if (short !== plain(element.name)) continue;
    for (const key of new Set([short, bare])) columns.set(key, [...(columns.get(key) ?? []), ...element.names]);
  }
  return {
    sourceId,
    schemas: new Set(exported.elements.flatMap((element) => (element.name.includes(".") ? [plain(element.name.slice(0, element.name.indexOf(".")))] : []))),
    words: new Set(text.match(WORDS)),
    dotted,
    columns,
    elements,
  };
}

/**
 * Checks the names a domain file cites in its code against the export of the source.
 *
 * @remarks
 * In any code, inline or fenced, a name that begins with a schema of the source must be written somewhere
 * in the export: an element, or what a definition names, such as a type. A column written after such a name
 * must be one of the relation. Both are errors, and the harness proposes the element of the same name in
 * another schema when there is exactly one. Two cases are doubtful and only warned of: a column written
 * after the name of a relation without its schema, which may be an alias, and a lone inline name of several
 * words joined by underscores that the export writes nowhere, which may be a value.
 *
 * @param body - The markdown body of the file.
 * @param vocabulary - What the export of the source names.
 * @returns What is wrong, and what is doubtful, each once.
 */
export function citedNameProblems(body: string, vocabulary: ExportVocabulary): { readonly errors: string[]; readonly warnings: string[] } {
  const errors = new Set<string>();
  const doubtful = new Map<string, string>();
  const { sourceId, schemas, words, dotted, columns, elements } = vocabulary;
  const fenced = [...body.matchAll(FENCED)].map((match) => match[1]!);
  const inline = [...body.replace(FENCED, "").matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!);
  for (const code of [...fenced, ...inline]) {
    for (const written of code.replaceAll('"', "").match(DOTTED) ?? []) {
      const parts = plain(written).split(".");
      const qualified = schemas.has(parts[0]!);
      const relation = qualified ? `${parts[0]}.${parts[1]}` : parts[0]!;
      const column = qualified ? parts[2] : parts[1];
      const listed = columns.get(relation);
      if (qualified && !dotted.has(relation)) {
        const same = elements.get(parts[1]!) ?? [];
        const proposal = same.length === 1 ? ` Proposed: \`${same[0]}\`.` : " Remove it, or use a name the request shows.";
        errors.add(`${written.split(".").slice(0, 2).join(".")} is not an element of ${sourceId}, and nothing in its export has this name.${proposal}`);
      } else if (listed !== undefined && listed.length > 0 && column !== undefined && !listed.map(plain).includes(column)) {
        const told = `${written}: ${relation} has no column ${column}. Its columns: ${listed.join(", ")}.`;
        if (qualified) errors.add(told);
        else doubtful.set(told, relation);
      }
    }
  }
  const lone = inline.filter((code) => SNAKE.test(code) && !words.has(code));
  const warnings = [
    ...[...doubtful].map(([told, relation]) => `${told} If ${relation} is not that relation here, answer again with the same body to confirm.`),
    ...(lone.length === 0
      ? []
      : [
          `The export of ${sourceId} writes these names nowhere: ${[...new Set(lone)].map((name) => `\`${name}\``).join(", ")}. If they are columns or elements, use the names the request shows. If they are something else, answer again with the same body to confirm.`,
        ]),
  ];
  return { errors: [...errors], warnings };
}

/** A name as it is compared: in lower case, without double quotes. */
function plain(name: string): string {
  return name.replaceAll('"', "").toLowerCase();
}

/** A dotted name and each of its beginnings of two parts or more. */
function beginnings(name: string): string[] {
  const parts = name.split(".");
  return parts.slice(1).map((_, i) => parts.slice(0, i + 2).join("."));
}
