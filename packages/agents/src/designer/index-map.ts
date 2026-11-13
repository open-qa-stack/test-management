import type { ToolDefinition } from "@open-qa-stack/domain";
import type { DomainIndex, SourceCard } from "@open-qa-stack/shared";
import { scopedToolName } from "@open-qa-stack/tools";

/** Name of the tool that finds the domains and elements of the index that echo words. */
export const FIND_TOOL = "index_find";
/** Name of the tool that gives a domain or an element of the index with its sources and their tools. */
export const ENTRY_TOOL = "index_entry";
/** Most domains, and most elements, a search gives. */
const MAX_FOUND = 12;
/** Shortest word a search matches on its start. */
const MIN_STEM = 4;

/** An element of a source, as the index places it. */
interface Element {
  readonly source: string;
  readonly item: string;
  /** What the card of the source says of it, when it does. */
  readonly summary?: string;
  /** The domains it belongs to; none for an element the index left unassigned. */
  readonly domains: readonly string[];
}

/**
 * The domain index as a map the designer looks things up in, rather than a text it receives whole: which
 * domains and elements echo a request, then, for one of them, its sources and the tools that read them.
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
    const summaries = new Map<string, string>([...cards].flatMap(([source, card]) => card.domains.flatMap((domain) => domain.items.map((item) => [`${source}\n${item.name}`, item.summary] as const))));
    const placed = new Map<string, { source: string; item: string; domains: string[] }>();
    const place = (source: string, item: string, domain?: string) => {
      const key = `${source}\n${item}`;
      const element = placed.get(key) ?? { source, item, domains: [] };
      if (domain !== undefined && !element.domains.includes(domain)) element.domains.push(domain);
      placed.set(key, element);
    };
    for (const domain of index.domains) for (const references of domain.references) for (const item of references.items) place(references.source, item, domain.id);
    for (const references of index.unassigned) for (const item of references.items) place(references.source, item);
    this.elements = [...placed].map(([key, element]) => {
      const summary = summaries.get(key);
      return summary === undefined ? element : { ...element, summary };
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
   * The tools the designer looks the index up with.
   *
   * @returns `index_find`, then `index_entry`.
   */
  public toolset(): ToolDefinition[] {
    return [
      {
        name: FIND_TOOL,
        description: `Finds the domains and the elements of the domain index that echo words: sections of documents, operations of contracts, tables, folders of code, screens. Give the words in the language of the index, with synonyms. Then call ${ENTRY_TOOL} to know where an element is and which tool reads it.`,
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
        description: "Gives a domain of the index, or one element of a source, with each source it is in and the tools that read that source.",
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

  /** The domains and elements that echo words, those that echo most first. */
  private find(words: string): string {
    const stems = wordsOf(words);
    if (stems.length === 0) return "Give at least one word of two letters or more.";
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
    const elements = ranked(this.elements, (element) => `${element.item} ${element.summary ?? ""}`);
    if (domains.length === 0 && elements.length === 0) return `Nothing of the index echoes "${words}". Try other words, or read the sources with their tools: the index is a map, not a limit.`;
    return [
      ...(domains.length === 0 ? [] : ["Domains:", ...domains.map((domain) => `- ${domain.id} (${domain.label}): ${domain.description}`)]),
      ...(elements.length === 0 ? [] : ["Elements:", ...elements.map((element) => this.line(element))]),
      `Call ${ENTRY_TOOL} with a domain, or with a source and an item, to know which tools read them.`,
    ].join("\n");
  }

  /** A domain, or an element, with its sources and their tools. */
  private entry(args: { domain?: string; source?: string; item?: string }): string | { error: string } {
    if (args.domain !== undefined) {
      const domain = this.index.domains.find((candidate) => candidate.id === args.domain);
      if (domain === undefined) return { error: `No domain ${args.domain} in the index; the domains are ${this.index.domains.map((candidate) => candidate.id).join(", ")}.` };
      const sources = domain.references.map((references) => [
        this.source(references.source),
        ...[...new Set(references.items)].map((item) => this.line(this.elements.find((element) => element.source === references.source && element.item === item)!)),
      ]);
      return [`${domain.id} (${domain.label}): ${domain.description}`, ...sources.flat()].join("\n");
    }
    if (args.source === undefined || args.item === undefined) return { error: "Give a domain, or a source and an item." };
    const element = this.elements.find((candidate) => candidate.source === args.source && candidate.item === args.item);
    if (element === undefined) return { error: `The index places no ${args.item} in ${args.source}; ${FIND_TOOL} gives the elements it places.` };
    return [this.source(element.source), this.line(element), `Domains: ${element.domains.length === 0 ? "none, the index left it unassigned" : element.domains.join(", ")}.`].join("\n");
  }

  /** A source, with its type and the tools that read it; a valid index lists every source it refers to. */
  private source(id: string): string {
    const { type } = this.index.sources.find((source) => source.id === id)!;
    const tools = this.tools.get(id) ?? [];
    return `Source ${id} (${type}): ${tools.length === 0 ? "no tool of yours reads it" : `read it with ${tools.join(", ")}`}.`;
  }

  /** An element, in one line. */
  private line(element: Element): string {
    return `- ${element.source}: ${element.item}${element.summary === undefined ? "" : ` — ${element.summary}`}`;
  }
}

/** The tools of each source, a tool going to the source whose scoped prefix is the longest start of its name. */
function toolsBySource(tools: readonly string[], sources: readonly string[]): Map<string, string[]> {
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
