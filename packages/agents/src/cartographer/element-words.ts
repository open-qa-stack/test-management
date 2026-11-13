import type { IndexSourceType, SourceInventory } from "@open-qa-stack/shared";

/** Shortest word of a name that ties it to others. */
const MIN_LENGTH = 3;
/** Words that tie no element to another. */
const STOP_WORDS = new Set("the and for with from des les une pour avec dans par sur".split(" "));
/** The types of source whose names begin with a structural prefix: the schema of a table, the root of a folder. */
const PREFIXED: ReadonlySet<IndexSourceType | undefined> = new Set<IndexSourceType>(["postgresql", "source-code"]);

/** An element of a source. */
export interface SourceElement {
  readonly source: string;
  readonly item: string;
}

/**
 * The words of the names of the elements of the cards, which tie an element to those of other sources that
 * share one.
 *
 * @remarks
 * In a base or in source code of two elements or more, the leading words every element begins with, such as
 * the schema of its tables or the root of its folders, are left out, as long as each element keeps one: they
 * tie every element of the source alike. One of them is kept when an element of another source has it too,
 * that source's own leading words left out the same way: it then ties the source to that element.
 */
export class ElementWords {
  private readonly words: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;

  /**
   * @param inventory - The elements of the card of each source.
   * @param types - The type of each source, by its identifier.
   */
  public constructor(inventory: SourceInventory, types: ReadonlyMap<string, IndexSourceType>) {
    const split = [...inventory].filter(([, items]) => items.length > 0).map(([source, items]) => ({ source, items, words: items.map(nameWords) }));
    const prefixes = new Map(split.map(({ source, words }) => [source, PREFIXED.has(types.get(source)) ? commonPrefix(words) : 0] as const));
    const rest = (source: string, words: readonly string[]) => words.slice(prefixes.get(source));
    this.words = new Map(
      split.map(({ source, items, words }) => {
        const elsewhere = new Set(split.filter((other) => other.source !== source).flatMap((other) => other.words.flatMap((element) => rest(other.source, element))));
        const kept = (element: readonly string[]) => [...element.slice(0, prefixes.get(source)).filter((word) => elsewhere.has(word)), ...rest(source, element)];
        return [source, new Map(items.map((item, i) => [item, [...new Set(kept(words[i]!))]] as const))] as const;
      }),
    );
  }

  /**
   * The words two elements share.
   *
   * @param element - An element.
   * @param other - Another element.
   * @returns The words, in the order of `element`; none when both are of one source, or either is no element of its source.
   */
  public shared(element: SourceElement, other: SourceElement): string[] {
    if (element.source === other.source) return [];
    const theirs = this.of(other);
    return this.of(element).filter((word) => theirs.includes(word));
  }

  private of({ source, item }: SourceElement): readonly string[] {
    return this.words.get(source)?.get(item) ?? [];
  }
}

/**
 * The words of a name: those of three letters or more, without digits, in lower case and without accents,
 * each plural read as its singular (`policies` as `policy`, `addresses` as `address`, `orders` as `order`), and a few that tie nothing,
 * such as `the` or `and`, left out.
 *
 * @param name - The name of an element.
 * @returns Its words, in order, a repeated one each time.
 */
export function nameWords(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length >= MIN_LENGTH && !STOP_WORDS.has(word))
    .map(singular);
}

/** How many leading words every element begins with, each keeping one at least; none for a single element. */
function commonPrefix(split: readonly (readonly string[])[]): number {
  if (split.length < 2) return 0;
  const most = Math.min(...split.map((words) => words.length)) - 1;
  let common = 0;
  while (common < most && split.every((words) => words[common] === split[0]![common])) common++;
  return common;
}

function singular(word: string): string {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses")) return word.slice(0, -2);
  return word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}
