import {
  indexSourceApplications,
  type CardItem,
  type DomainIndex,
  type IndexSourceType,
  type Knowledge,
  type SourceCard,
  type SourceManifest,
  type ToolDefinition,
} from "@open-qa-stack/domain";
import { scopedToolName, sourceReach, type SourceReach } from "@open-qa-stack/tools";

/** Name of the tool that gives a domain: the sources that hold it, then what one of them says of it. */
export const DOMAIN_TOOL = "knowledge_domain";
/** Name of the tool that lists the elements of the knowledge, by kind, by domain or by words. */
export const LIST_TOOL = "knowledge_list";
/** Name of the tool that gives one element of a source, with what is known of it and the call that reads it. */
export const READ_TOOL = "knowledge_read";
/** Most elements `knowledge_list` gives. */
const MAX_LISTED = 40;
/** Longest text `knowledge_domain` gives of the files of a source, and `knowledge_read` of the definition of an element, in characters. */
const MAX_WRITTEN_LENGTH = 8000;
/** Shortest word a search matches on its start. */
const MIN_STEM = 4;
/** Most lines `knowledge_domain` and `knowledge_read` give of the elements of a card. */
const MAX_ENTRY_LINES = 60;

/** What an element of a source is, by the type of its source. */
const KINDS: Readonly<Record<IndexSourceType, string>> = {
  openapi: "operations",
  postgresql: "table",
  document: "section",
  "source-code": "folder",
  web: "screen",
};

/** What the workflow of a source wrote of it, beside its card: its manifest, the file of each of its domains, and its export. */
export interface WrittenSource {
  /** The manifest of the source: where each of its elements was placed. */
  readonly manifest: SourceManifest;
  /** The markdown file of each of its domains that has one, by identifier of the domain. */
  readonly files: ReadonlyMap<string, string>;
  /**
   * Reads a file of the folder of the source, such as the definition of an element in its export.
   *
   * @param file - Path of the file, from the folder of the source.
   * @returns Its text, or `undefined` when it cannot be read.
   */
  read(file: string): Promise<string | undefined>;
}

/** What tells the applications each source of the index describes, and those the session tests. */
export interface IndexReach {
  /** The knowledge sources of the configuration, whose attachments name the applications of each. */
  readonly knowledge: readonly Pick<Knowledge, "id" | "attachments">[];
  /** The applications the session tests, which a source describing only others warns of; none for a session that is not kept to some. */
  readonly applications?: readonly string[];
}

/** An element of a source, as the index places it. */
interface Element {
  readonly source: string;
  /** The applications its source describes; none for a source of the whole project. */
  readonly applications: readonly string[];
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
 *
 * Each element names the applications its source describes, as the configuration attaches it rather than as the index
 * was written, so that an index of any age tells them; an element of a source that describes only applications the
 * session does not test comes with the warning its tools give.
 */
export class IndexMap {
  private readonly index: DomainIndex;
  private readonly elements: readonly Element[];
  private readonly tools: ReadonlyMap<string, readonly string[]>;
  private readonly written: ReadonlyMap<string, WrittenSource>;
  private readonly reach: IndexReach;

  /**
   * @param index - The domain index.
   * @param cards - The card of each source that has a readable one, for what it says of each element.
   * @param tools - The tools the designer has, to name those of each source.
   * @param owners - Every knowledge source and application the tools are scoped by, those the index does not list included.
   * @param written - What the workflow of each source wrote of it, for the sources that have one.
   * @param reach - What tells the applications of each source and those the session tests; no source attached to one by default.
   */
  public constructor(
    index: DomainIndex,
    cards: ReadonlyMap<string, SourceCard>,
    tools: readonly ToolDefinition[],
    owners: readonly string[],
    written: ReadonlyMap<string, WrittenSource> = new Map(),
    reach: IndexReach = { knowledge: [] },
  ) {
    this.index = index;
    this.written = written;
    this.reach = reach;
    const described = new Map<string, CardItem>(
      [...cards].flatMap(([source, card]) => card.domains.flatMap((domain) => domain.items.map((item) => [`${source}\n${item.name}`, item] as const))),
    );
    const placed = new Map<string, { source: string; applications: readonly string[]; item: string; kind: string; domains: string[] }>();
    const place = (source: string, item: string, domain?: string) => {
      const key = `${source}\n${item}`;
      // A valid index lists every source it refers to.
      const listed = index.sources.find((candidate) => candidate.id === source)!;
      const said = described.get(key)?.facts?.["kind"];
      const kind = typeof said === "string" ? said : KINDS[listed.type];
      const element = placed.get(key) ?? { source, applications: indexSourceApplications(listed, reach.knowledge), item, kind, domains: [] };
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
   * The domains of the knowledge, in one line each, for the request that starts the session that plans: what
   * each is, and how many elements of each kind the sources hold of it.
   *
   * @returns The lines.
   */
  public domains(): string[] {
    return this.index.domains.map((domain) => {
      const held = this.elements.filter((element) => element.domains.includes(domain.id));
      return `- ${domain.id} (${domain.label}): ${domain.description} ${held.length === 0 ? "No element yet" : sentence(counted(held))}.`;
    });
  }

  /**
   * The tools the designer explores the knowledge with, by levels: a domain, the elements, one element.
   *
   * @returns `knowledge_domain`, `knowledge_list`, then `knowledge_read`.
   */
  public toolset(): ToolDefinition[] {
    return [
      {
        name: DOMAIN_TOOL,
        description: `Gives a domain of the knowledge. With the domain alone: the sources that hold it, what each holds of it and the tools that read each. With a source too: what that source says of the domain, such as its tables with their role, their columns and their links. Then call ${READ_TOOL} on an element, or the tools of the source.`,
        parameters: {
          type: "object",
          properties: {
            domain: { type: "string", minLength: 1, description: "Identifier of a domain, as the request lists them." },
            source: { type: "string", minLength: 1, description: "Identifier of a source that holds the domain, for what it says of it." },
          },
          required: ["domain"],
          additionalProperties: false,
        },
        execute: async (args) => this.domain(args as { domain: string; source?: string }),
      },
      {
        name: LIST_TOOL,
        description: `Lists the elements of the knowledge, a line each: the screens, the tables, the operations, the sections of documents, the folders of code. Narrow the list with a kind, a domain, or words in the language of the knowledge, with synonyms. Then call ${READ_TOOL} on an element.`,
        parameters: {
          type: "object",
          properties: {
            kind: { type: "string", minLength: 1, description: "What the elements are, such as: screen, table, view, operations, section, folder." },
            domain: { type: "string", minLength: 1, description: "Identifier of a domain." },
            words: { type: "string", minLength: 1, description: "Words of what you look for, such as: customer search profile." },
          },
          additionalProperties: false,
        },
        execute: async (args) => this.list(args as { kind?: string; domain?: string; words?: string }),
      },
      {
        name: READ_TOOL,
        description:
          "Gives one element of a source, with what is known of it and the call that reads it: for a table, its keys, its key fields, its definition and the call that finds a row.",
        parameters: {
          type: "object",
          properties: {
            source: { type: "string", minLength: 1, description: "Identifier of a source." },
            item: { type: "string", minLength: 1, description: `An element of that source, as ${LIST_TOOL} gives it.` },
          },
          required: ["source", "item"],
          additionalProperties: false,
        },
        execute: async (args) => this.read(args as { source: string; item: string }),
      },
    ];
  }

  /** A domain in short, or what one of its sources says of it. */
  private domain(args: { domain: string; source?: string }): string | { error: string } {
    const domain = this.index.domains.find((candidate) => candidate.id === args.domain);
    const known = this.index.domains.map((candidate) => candidate.id).join(", ");
    if (domain === undefined) {
      const source = this.index.sources.some((candidate) => candidate.id === args.domain);
      return { error: `${args.domain} is ${source ? "a source, not a domain" : "no domain of the knowledge"}; the domains are ${known}.` };
    }
    const held = (source: string) => this.elements.filter((element) => element.source === source && element.domains.includes(domain.id));
    const sources = domain.references.map((references) => references.source);
    if (args.source === undefined)
      return [
        `${domain.id} (${domain.label}): ${domain.description}`,
        "The sources that hold it:",
        ...sources.map((source) => `- ${this.source(source)} It holds ${counted(held(source))}.`),
        `Call ${DOMAIN_TOOL} with one of these sources for what it says of the domain, or ${LIST_TOOL} with the domain for its elements.`,
      ].join("\n");
    if (!sources.includes(args.source)) return { error: `${args.source} holds nothing of the domain ${domain.id}; its sources are ${sources.join(", ")}.` };
    const elements = held(args.source);
    const written = this.written.get(args.source);
    const placed = new Set(elements.flatMap((element) => written?.manifest.elements.find((known) => known.name === element.item)?.domain ?? []));
    const files = [...placed].flatMap((id) => written?.files.get(id) ?? []);
    const said = files.length === 0 ? capped(elements.map(line)) : shortened(files.join("\n\n"), `call ${READ_TOOL} on an element for the rest`);
    return [this.source(args.source), "", said].join("\n");
  }

  /** The elements of the knowledge of a kind, of a domain, or that echo words, those that echo most first. */
  private list(args: { kind?: string; domain?: string; words?: string }): string | { error: string } {
    if (args.domain !== undefined && !this.index.domains.some((candidate) => candidate.id === args.domain))
      return { error: `${args.domain} is no domain of the knowledge; the domains are ${this.index.domains.map((candidate) => candidate.id).join(", ")}.` };
    const stems = wordsOf(args.words ?? "");
    const score = (element: Element) => {
      const own = wordsOf(`${element.item} ${element.card?.summary ?? ""} ${(element.card?.keyFields ?? []).join(" ")}`);
      return stems.filter((stem) => own.some((word) => echoes(word, stem))).length;
    };
    const kept = this.elements
      .filter((element) => args.kind === undefined || echoes(element.kind, args.kind.toLowerCase()))
      .filter((element) => args.domain === undefined || element.domains.includes(args.domain))
      .map((element) => ({ element, score: score(element) }))
      .filter(({ score: echoed }) => stems.length === 0 || echoed > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ element }) => element);
    if (kept.length === 0) {
      const kinds = [...new Set(this.elements.map((element) => element.kind))].join(", ");
      return `Nothing of the knowledge matches. Its kinds are ${kinds}. Try other words, or read the sources with their tools: the knowledge is a map, not a limit.`;
    }
    const more = kept.length > MAX_LISTED ? [`${kept.length - MAX_LISTED} more: narrow the list with a kind, a domain or words.`] : [];
    const shown = kept.slice(0, MAX_LISTED);
    const warnings = [...new Set(shown.map((element) => element.source))].flatMap((source) => this.warning(source));
    return [`${counted(kept)}:`, ...shown.map(line), ...more, ...warnings, `Call ${READ_TOOL} with a source and an item for what is known of one.`].join("\n");
  }

  /** An element, with its source and its tools, what its card says of it and, when its source wrote one, its definition. */
  private async read(args: { source: string; item: string }): Promise<string | { error: string }> {
    const element = this.elements.find((candidate) => candidate.source === args.source && candidate.item === args.item);
    if (element === undefined) return { error: `The knowledge places no ${args.item} in ${args.source}; ${LIST_TOOL} gives the elements it places.` };
    const file = this.written.get(element.source)?.manifest.elements.find((known) => known.name === element.item)?.file;
    const definition = file === undefined ? undefined : await this.written.get(element.source)!.read(file);
    return capped([
      this.source(element.source),
      line(element),
      ...(element.card?.keyFields === undefined ? [] : [`Key fields: ${element.card.keyFields.join(", ")}.`]),
      ...Object.entries(element.card?.facts ?? {}).map(([name, value]) => `${name}: ${factText(value)}`),
      ...this.rowCall(element),
      `Domains: ${element.domains.length === 0 ? "none, the knowledge left it unassigned" : element.domains.join(", ")}.`,
      ...(definition === undefined ? [] : [`Definition, from ${file}:`, shortened(definition, "read the source for the rest")]),
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

  /**
   * A source, with its type, the tools that read it and the applications it describes, with the warning of a source
   * that describes only applications the session does not test; a valid index lists every source it refers to.
   */
  private source(id: string): string {
    const { type } = this.index.sources.find((source) => source.id === id)!;
    const tools = this.tools.get(id) ?? [];
    const reach = this.reachOf(id);
    const told = reach === undefined ? "" : ` ${reach.warning ?? reach.named}`;
    return `Source ${id} (${type}): ${tools.length === 0 ? "no tool of yours reads it" : `read it with ${tools.join(", ")}`}.${told}`;
  }

  /** The warning of a source that describes only applications the session does not test, or none. */
  private warning(id: string): string[] {
    const warning = this.reachOf(id)?.warning;
    return warning === undefined ? [] : [warning];
  }

  /** What the session is told of the applications a source describes; nothing for a source of the whole project. A valid index lists every source it refers to. */
  private reachOf(id: string): SourceReach | undefined {
    const listed = this.index.sources.find((source) => source.id === id)!;
    return sourceReach(id, indexSourceApplications(listed, this.reach.knowledge), this.reach.applications);
  }
}

/** An element, in one line: its source, its name, its summary, what it is and the applications its source describes. */
function line(element: Element): string {
  const { applications } = element;
  const of = applications.length === 0 ? "" : `, of ${applications.length === 1 ? "the application" : "the applications"} ${applications.join(", ")}`;
  return `- ${element.source}: ${element.item}${element.card === undefined ? "" : ` — ${element.card.summary}`} (${element.kind}${of})`;
}

/** A fact of a card, in words: a list joined by commas, anything else as JSON. */
function factText(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry))).join(", ");
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Lines joined, at most `MAX_ENTRY_LINES` of them. */
function capped(lines: readonly string[]): string {
  if (lines.length <= MAX_ENTRY_LINES) return lines.join("\n");
  return [...lines.slice(0, MAX_ENTRY_LINES - 1), `${lines.length - MAX_ENTRY_LINES + 1} more lines; ask ${READ_TOOL} for one element at a time.`].join("\n");
}

/** A text cut to the longest length given, with what to do for the rest. */
function shortened(text: string, rest: string): string {
  return text.length <= MAX_WRITTEN_LENGTH ? text : `${text.slice(0, MAX_WRITTEN_LENGTH)}\n… cut after ${MAX_WRITTEN_LENGTH} characters; ${rest}.`;
}

/** A text with its first letter in upper case. */
function sentence(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** How many elements of each kind, in words, such as `2 tables, 1 screen`. */
function counted(elements: readonly Element[]): string {
  const kinds = [...new Set(elements.map((element) => element.kind))];
  return kinds
    .map((kind) => {
      const count = elements.filter((element) => element.kind === kind).length;
      return `${count} ${count === 1 || kind.endsWith("s") ? kind : `${kind}s`}`;
    })
    .join(", ");
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
