import type { ToolDefinition } from "@open-qa-stack/domain";
import type { CardItem, DomainIndex, IndexSourceType, SourceCard } from "@open-qa-stack/shared";
import { scopedToolName } from "@open-qa-stack/tools";

/** Name of the tool that finds the domains and elements of the index that echo words. */
export const FIND_TOOL = "index_find";
/** Name of the tool that gives a domain or an element of the index with its sources and their tools. */
export const ENTRY_TOOL = "index_entry";
/** Most domains, and most elements, a search gives. */
const MAX_FOUND = 12;
/** Shortest word a search matches on its start. */
const MIN_STEM = 4;
/** Most lines `index_entry` gives. */
const MAX_ENTRY_LINES = 60;

/** What an element of a source is, by the type of its source. */
const KINDS: Readonly<Record<IndexSourceType, string>> = {
  openapi: "operations",
  postgresql: "table",
  document: "section",
  "source-code": "folder",
  web: "screen",
};

/** An element of a source, as the index places it. */
interface Element {
  readonly source: string;
  readonly item: string;
  /** What it is: a table, a screen, a section, operations or a folder. */
  readonly kind: string;
  /** What the card of the source says of it, when it does: its summary, its key fields and the facts the harness read. */
  readonly card?: CardItem;
  /** The domains it belongs to; none for an element the index left unassigned. */
  readonly domains: readonly string[];
}

/**
 * The domain index as a map the designer looks things up in, rather than a text it receives whole: which
 * domains and elements echo a request, then, for one of them, what its card holds, its sources and the
 * tools that read them, and, for a table, the call that finds one of its rows.
 *
 * @remarks
 * Words match without regard to case or accents, a word matching another it begins, or that begins it,
 * when the shorter of the two has four letters or more, so that `customer` finds `Customers`. The index is a map, not a limit: the tools
 * of a source read the whole source, not only what the index places in it.
 */
export class IndexMap {
  private readonly index: DomainIndex;
  private readonly elements: readonly Element[];
  private readonly tools: ReadonlyMap<string, readonly string[]>;

  /**
   * @param index - The domain index.
   * @param cards - The card of each source that has a readable one, for what it says of each element.
   * @param tools - The tools the designer has, to name those of each source.
   * @param owners - Every knowledge source and application the tools are scoped by, those the index does not list included.
   */
  public constructor(index: DomainIndex, cards: ReadonlyMap<string, SourceCard>, tools: readonly ToolDefinition[], owners: readonly string[]) {
    this.index = index;
    const described = new Map<string, CardItem>(
      [...cards].flatMap(([source, card]) => card.domains.flatMap((domain) => domain.items.map((item) => [`${source}\n${item.name}`, item] as const))),
    );
    const placed = new Map<string, { source: string; item: string; kind: string; domains: string[] }>();
    const place = (source: string, item: string, domain?: string) => {
      const key = `${source}\n${item}`;
      // A valid index lists every source it refers to.
      const element = placed.get(key) ?? { source, item, kind: KINDS[index.sources.find((candidate) => candidate.id === source)!.type], domains: [] };
      if (domain !== undefined && !element.domains.includes(domain)) element.domains.push(domain);
      placed.set(key, element);
    };
    for (const domain of index.domains)
      for (const references of domain.references) for (const item of references.items) place(references.source, item, domain.id);
    for (const references of index.unassigned) for (const item of references.items) place(references.source, item);
    this.elements = [...placed].map(([key, element]) => {
      const card = described.get(key);
      return card === undefined ? element : { ...element, card };
    });
    this.tools = toolsBySource(
      tools.map((tool) => tool.name),
      owners,
    );
  }

  /**
   * The domains of the index, in one line each, for the request of the designer.
   *
   * @returns The lines.
   */
  public domains(): string[] {
    return this.index.domains.map((domain) => `- ${domain.id} (${domain.label}): ${domain.description}`);
  }

  /**
   * The domains and the elements of the index that echo words, those that echo most first, at most
   * `MAX_FOUND` of each: what an element is called, its summary and its key fields are searched.
   *
   * @param words - Words of what is looked for, such as the brief of a design.
   * @returns The lines that give them, under `Domains:` and `Elements:`; none when nothing echoes.
   */
  public found(words: string): string[] {
    const stems = wordsOf(words);
    const score = (text: string) => {
      const own = wordsOf(text);
      return stems.filter((stem) => own.some((word) => echoes(word, stem))).length;
    };
    const ranked = <T>(entries: readonly T[], text: (entry: T) => string) =>
      entries
        .map((entry) => ({ entry, score: score(text(entry)) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_FOUND)
        .map(({ entry }) => entry);
    const domains = ranked(this.index.domains, (domain) => `${domain.id} ${domain.label} ${domain.description}`);
    const elements = ranked(this.elements, (element) => `${element.item} ${element.card?.summary ?? ""} ${(element.card?.keyFields ?? []).join(" ")}`);
    return [
      ...(domains.length === 0 ? [] : ["Domains:", ...domains.map((domain) => `- ${domain.id} (${domain.label}): ${domain.description}`)]),
      ...(elements.length === 0 ? [] : ["Elements:", ...elements.map((element) => line(element))]),
    ];
  }

  /**
   * The tools the designer looks the index up with.
   *
   * @returns `index_find`, then `index_entry`.
   */
  public toolset(): ToolDefinition[] {
    return [
      {
        name: FIND_TOOL,
        description: `Finds what echoes words in the index: domains, sections of documents, operations, tables, folders of code, screens. Give the words in the language of the index, with synonyms. Then call ${ENTRY_TOOL} on an element.`,
        parameters: {
          type: "object",
          properties: { words: { type: "string", minLength: 1, description: "Words of what you look for, such as: customer search profile." } },
          required: ["words"],
          additionalProperties: false,
        },
        execute: async (args) => this.find((args as { words: string }).words),
      },
      {
        name: ENTRY_TOOL,
        description:
          "Gives a domain of the index, or one element of a source, with what is known of it and the call that reads it: for a table, its keys, its key fields and the call that finds a row.",
        parameters: {
          type: "object",
          properties: {
            domain: { type: "string", description: "Identifier of a domain of the index." },
            source: { type: "string", description: "Identifier of a source of the index, with item." },
            item: { type: "string", description: "An element of that source, as index_find gives it." },
          },
          additionalProperties: false,
        },
        execute: async (args) => this.entry(args as { domain?: string; source?: string; item?: string }),
      },
    ];
  }

  /** The domains and elements that echo words, with what to do next. */
  private find(words: string): string {
    if (wordsOf(words).length === 0) return "Give at least one word of two letters or more.";
    const found = this.found(words);
    if (found.length === 0)
      return `Nothing of the index echoes "${words}". Try other words, or read the sources with their tools: the index is a map, not a limit.`;
    return [...found, `Call ${ENTRY_TOOL} with a domain, or with a source and an item, to know what is known of them and which tools read them.`].join("\n");
  }

  /** A domain, or else an element, with its sources and their tools: a call that names no domain of the index but an element is about the element. */
  private entry(args: { domain?: string; source?: string; item?: string }): string | { error: string } {
    const domain = this.index.domains.find((candidate) => candidate.id === args.domain);
    if (domain !== undefined) {
      const sources = domain.references.map((references) => [
        this.source(references.source),
        ...[...new Set(references.items)].map((item) => line(this.elements.find((element) => element.source === references.source && element.item === item)!)),
      ]);
      return capped([`${domain.id} (${domain.label}): ${domain.description}`, ...sources.flat()]);
    }
    if (args.source === undefined || args.item === undefined)
      return args.domain === undefined
        ? { error: "Give a domain, or a source and an item." }
        : { error: `No domain ${args.domain} in the index; the domains are ${this.index.domains.map((candidate) => candidate.id).join(", ")}.` };
    const element = this.elements.find((candidate) => candidate.source === args.source && candidate.item === args.item);
    if (element === undefined) return { error: `The index places no ${args.item} in ${args.source}; ${FIND_TOOL} gives the elements it places.` };
    return capped([
      this.source(element.source),
      line(element),
      ...(element.card?.keyFields === undefined ? [] : [`Key fields: ${element.card.keyFields.join(", ")}.`]),
      ...Object.entries(element.card?.facts ?? {}).map(([name, value]) => `${name}: ${factText(value)}`),
      ...this.rowCall(element),
      `Domains: ${element.domains.length === 0 ? "none, the index left it unassigned" : element.domains.join(", ")}.`,
    ]);
  }

  /** The call that finds a row of a table, named `schema.table`, when the agent has the search tool of its base. */
  private rowCall(element: Element): string[] {
    const search = scopedToolName(element.source, "search");
    const at = element.item.indexOf(".");
    if (element.kind !== "table" || !(this.tools.get(element.source) ?? []).includes(search)) return [];
    const quoted = (text: string) => JSON.stringify(text);
    return [`Find a row: ${search}({ "schema": ${quoted(element.item.slice(0, at))}, "table": ${quoted(element.item.slice(at + 1))}, "value": "<text>" })`];
  }

  /** A source, with its type and the tools that read it; a valid index lists every source it refers to. */
  private source(id: string): string {
    const { type } = this.index.sources.find((source) => source.id === id)!;
    const tools = this.tools.get(id) ?? [];
    return `Source ${id} (${type}): ${tools.length === 0 ? "no tool of yours reads it" : `read it with ${tools.join(", ")}`}.`;
  }
}

/** An element, in one line: its source, its name, its summary and what it is. */
function line(element: Element): string {
  return `- ${element.source}: ${element.item}${element.card === undefined ? "" : ` — ${element.card.summary}`} (${element.kind})`;
}

/** A fact of a card, in words: a list joined by commas, anything else as JSON. */
function factText(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry))).join(", ");
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Lines joined, at most `MAX_ENTRY_LINES` of them. */
function capped(lines: readonly string[]): string {
  if (lines.length <= MAX_ENTRY_LINES) return lines.join("\n");
  return [...lines.slice(0, MAX_ENTRY_LINES - 1), `${lines.length - MAX_ENTRY_LINES + 1} more lines; ask ${ENTRY_TOOL} for one element at a time.`].join("\n");
}

/**
 * The tools of each source, a tool going to the source whose scoped prefix is the longest start of its name.
 *
 * @param tools - The names of the tools.
 * @param sources - Identifiers of the sources the tools are scoped by.
 * @returns The names of the tools of each source that has one, in their order.
 */
export function toolsBySource(tools: readonly string[], sources: readonly string[]): Map<string, string[]> {
  const prefixes = sources.map((source) => ({ source, prefix: scopedToolName(source, "") })).sort((a, b) => b.prefix.length - a.prefix.length);
  const bySource = new Map<string, string[]>();
  for (const tool of tools) {
    const owner = prefixes.find(({ prefix }) => tool.startsWith(prefix));
    if (owner !== undefined) bySource.set(owner.source, [...(bySource.get(owner.source) ?? []), tool]);
  }
  return bySource;
}

/** The words of a text, in lower case and without accents. */
function wordsOf(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2);
}

/** Whether a word echoes a word searched: the same, or, from `MIN_STEM` letters, the start of the other. */
function echoes(word: string, searched: string): boolean {
  if (word === searched) return true;
  const [short, long] = word.length < searched.length ? [word, searched] : [searched, word];
  return short.length >= MIN_STEM && long.startsWith(short);
}
