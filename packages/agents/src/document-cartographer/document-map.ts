import type { ToolDefinition } from "@open-qa-stack/domain";
import { SLUG_PATTERN, type ManifestDomain } from "@open-qa-stack/shared";
import {
  exportFile,
  redactText,
  scopedToolName,
  secretForms,
  sourceExport,
  type DocumentFile,
  type DocumentSection,
  type DocumentSet,
  type ElementDraft,
  type SourceExport,
} from "@open-qa-stack/tools";
import type { Journal } from "../common/journal.ts";
import { minimalBody, unfenced, type DomainMember } from "../source-workflow/domain-file.ts";
import { domainFileErrors } from "../source-workflow/domain-file-control.ts";
import type { DomainFile } from "../source-workflow/export-manifest.ts";
import { Grouping, MAX_DOMAIN_ELEMENTS } from "../source-workflow/grouping.ts";
import { SET_ASIDE_TOOL, WRITE_DOMAIN_TOOL } from "./document-cartographer-prompt.ts";
import type { DocumentWatch } from "./document-watch.ts";

/** Calls the harness refuses before it closes the map: what is placed stays, the rest is left unplaced. */
export const MAX_REFUSED_CALLS = 10;
/** Times the file of one domain is refused before the harness writes it itself. */
export const MAX_REFUSED_BODIES = 3;
/** Fewest documents of a domain from which the harness asks whether enough of them were read. */
const SHARE_FROM = 3;
/** Longest label, description, role or reason, in characters. */
const MAX_LINE_LENGTH = 200;
/** Most documents a result names among those still to place. */
const MAX_NAMED = 20;
/** Longest start of a section its summary keeps, in characters. */
const START_LENGTH = 300;
const SLUG = new RegExp(SLUG_PATTERN);

/** An element as the agent gives it: a document, or one of its sections, with its role. */
interface GivenElement {
  readonly file?: unknown;
  readonly section?: unknown;
  readonly role?: unknown;
}

/** A part of the source: a whole document, or one of its sections with the sections it holds. */
interface Part {
  /** What names it: the path of the document, then the title of the section. */
  readonly name: string;
  readonly file: string;
  /** The section, for a part that is one; the whole document otherwise. */
  readonly section?: DocumentSection;
}

/** An element of a domain, once the harness found it in the source. */
interface PlacedElement extends DomainMember, Part {
  /** The text of the element. */
  readonly text: string;
}

/** A domain the agent handed in and the harness kept. */
interface KeptDomain {
  readonly domain: ManifestDomain;
  readonly elements: readonly PlacedElement[];
  readonly body: string;
  readonly writtenBy: DomainFile["writtenBy"];
  /** Why the harness wrote the body itself, and the body it refused, when it did. */
  readonly refused?: string;
  readonly refusedBody?: string;
}

/** What a map needs. */
export interface DocumentMapOptions {
  /** Identifier of the source. */
  readonly sourceId: string;
  /** Its documents. */
  readonly documents: DocumentSet;
  /** The documents a reader reads, as their listing gives them. */
  readonly files: readonly DocumentFile[];
  /** The sections of each document, by its path. */
  readonly sections: ReadonlyMap<string, readonly DocumentSection[]>;
  /** What the agent saw of them. */
  readonly watch: DocumentWatch;
  /** The secrets of the configuration, which no file of a domain may hold. */
  readonly secrets: readonly string[];
  /** Where what the harness refused, warned of and kept is written. */
  readonly journal: Journal;
}

/** What a map gives once its session is over. */
export interface DocumentMapResult {
  /** The elements the agent chose, then the documents and sections set aside and those left, as an export. */
  readonly exported: SourceExport;
  /** Where each element stands. */
  readonly grouping: Grouping;
  /** The file of each domain: its body, who wrote it, and what was refused when the harness did. */
  readonly files: ReadonlyMap<string, Pick<KeptDomain, "body" | "writtenBy" | "refused" | "refusedBody">>;
}

/**
 * The map of the documents of a source, as the agent that reads them hands it in, domain by domain.
 *
 * @remarks
 * The agent chooses its elements itself — a whole document, or one of its sections — and hands each domain
 * in with `write_domain`: its identifier, its elements with the role of each, and the body of its file. What
 * serves no functional area — a document, or a section such as a glossary — is set aside with `set_aside`.
 * The harness cuts nothing; it holds what is handed in to the source and to what the agent looked at, and
 * answers in three ways.
 *
 * It refuses, saying what to do: an identifier that is no slug, a document or a section the source does not
 * have, an element given twice or already in another domain, a document the agent neither listed the
 * sections of nor read, a part set aside the agent never saw or that is placed already, a body that does not
 * name every element between backticks, is too long or holds a secret. A domain is kept whole or not at
 * all, and handing in a domain kept again replaces it. It warns, once per domain: when the agent read the
 * text of less than a third of the documents of a domain of `SHARE_FROM` or more, the same call again
 * confirms that their titles told enough. It proposes nothing here: an element is the agent's to choose.
 *
 * The map is over once the whole source is covered, and not before. A document is covered when it is placed
 * or set aside whole. One the agent cut into sections is covered section by section: a section is covered
 * by itself or by one that holds it, and each section left that holds none covered is still to place or to
 * set aside, the largest first. What comes before the first heading of a document, and the lines of a
 * section before its first covered sub-section, are not counted.
 *
 * Every refusal has an exit. The third body refused for one domain is replaced by a table the harness
 * writes, and the domain is kept. After `MAX_REFUSED_CALLS` refusals the map is closed: what is placed
 * stays. What is in no domain and not set aside when the session ends is left unplaced, never lost: it is an
 * element of the export, with why.
 */
export class DocumentMap {
  private readonly options: DocumentMapOptions;
  private readonly forms: readonly string[];
  private readonly kept = new Map<string, KeptDomain>();
  /** The parts set aside, by their name, each with why. */
  private readonly aside = new Map<string, Part & { readonly reason: string }>();
  private readonly refusedBodies = new Map<string, number>();
  private readonly warned = new Set<string>();
  private refused = 0;

  /** @param options - What the map needs. */
  public constructor(options: DocumentMapOptions) {
    this.options = options;
    this.forms = options.secrets.flatMap(secretForms);
  }

  /**
   * Whether the map takes no more call.
   *
   * @returns `true` once the whole source is placed or set aside, or the harness closed the map.
   */
  public get closed(): boolean {
    return this.refused >= MAX_REFUSED_CALLS || this.remaining().length === 0;
  }

  /**
   * The tools the agent hands its map in with.
   *
   * @returns `write_domain` and `set_aside`.
   */
  public tools(): ToolDefinition[] {
    const line = { type: "string", minLength: 1 };
    return [
      {
        name: WRITE_DOMAIN_TOOL,
        description:
          "Hands one functional domain in: its elements, each a document or one of its sections with its role, then the markdown body of its file, which names every element between backticks. A domain handed in again replaces what was kept of it.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "An English slug: lower case letters and digits, separated by hyphens." },
            label: line,
            description: { ...line, description: "One sentence." },
            elements: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  file: { type: "string", description: "Path of the document, as list_files gives it." },
                  section: { type: "integer", minimum: 1, description: "Number of the section, as list_sections gives it; left out for the whole document." },
                  role: { ...line, description: "One line on what it states." },
                },
                required: ["file", "role"],
              },
            },
            body: { type: "string", description: "The markdown body of the file of the domain, without its title." },
          },
          required: ["id", "label", "description", "elements", "body"],
        },
        execute: async (args) => this.write(args as Record<string, unknown>),
      },
      {
        name: SET_ASIDE_TOOL,
        description:
          "Sets aside what serves no functional area, with why: whole documents, such as a change log, or sections of a document, such as its glossary. They stay in the source, in no domain.",
        parameters: {
          type: "object",
          properties: {
            elements: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  file: { type: "string", description: "Path of the document, as list_files gives it." },
                  section: { type: "integer", minimum: 1, description: "Number of the section, as list_sections gives it; left out for the whole document." },
                },
                required: ["file"],
              },
            },
            reason: { ...line, description: "Why, in one sentence." },
          },
          required: ["elements", "reason"],
        },
        execute: async (args) => this.setAside(args as Record<string, unknown>),
      },
    ];
  }

  /**
   * The message that reminds an agent which stopped while documents or sections are in no domain and not set aside.
   *
   * @returns The reminder; `undefined` once the map is closed.
   */
  public reminder(): string | undefined {
    if (this.closed) return undefined;
    this.record("info", `The agent stopped with ${this.remaining().length} documents or sections in no domain; it was reminded to place them.`);
    return `You stopped before the end. ${this.left()}`;
  }

  /**
   * What the map holds, once its session is over.
   *
   * @returns Its elements as an export, where each stands, and the file of each domain.
   */
  public async result(): Promise<DocumentMapResult> {
    const grouping = new Grouping();
    const drafts: ElementDraft[] = [];
    for (const { domain, elements } of this.kept.values()) {
      for (const element of elements) {
        drafts.push(draftOf(element));
        grouping.place(element.name, domain, element.role);
      }
    }
    // What is in no domain is an element all the same, by its text: set aside with its reason, or left with why.
    for (const part of this.aside.values()) {
      drafts.push(draftOf({ ...part, kind: kindOf(part), role: "", text: await this.text(part) }));
      grouping.dismiss(part.name, part.reason);
    }
    const remaining = this.remaining();
    for (const part of remaining) {
      drafts.push(draftOf({ ...part, kind: kindOf(part), role: "", text: await this.text(part) }));
      grouping.leave(part.name, "The session of the agent ended before it was placed or set aside.");
    }
    if (remaining.length > 0)
      this.record("error", `${remaining.length} documents or sections were left in no domain: ${remaining.map((part) => part.name).join(", ")}.`);
    return { exported: sourceExport(drafts), grouping, files: this.kept };
  }

  private async write(args: Record<string, unknown>): Promise<string | { error: string }> {
    if (this.closed) return this.over();
    const id = String(args["id"]);
    const domain = { id, label: oneLine(args["label"]), description: oneLine(args["description"]) };
    const problems = [...this.domainProblems(domain)];
    const elements: PlacedElement[] = [];
    const given = Array.isArray(args["elements"]) ? (args["elements"] as readonly GivenElement[]) : [];
    if (given.length === 0) problems.push("The domain has no element. Give its documents, or their sections, in elements.");
    if (given.length > MAX_DOMAIN_ELEMENTS)
      problems.push(`The domain has ${given.length} elements, ${MAX_DOMAIN_ELEMENTS} at most. Split it into two domains.`);
    for (const element of given.slice(0, MAX_DOMAIN_ELEMENTS)) {
      const found = await this.element(element, id, elements);
      if (typeof found === "string") problems.push(found);
      else elements.push(found);
    }
    if (problems.length > 0) return this.refuse(`The domain ${id} was not kept`, problems);
    const body = unfenced(typeof args["body"] === "string" ? args["body"] : "");
    const flaws = domainFileErrors(body, elements, this.options.secrets);
    const refusals = flaws.length === 0 ? 0 : (this.refusedBodies.get(id) ?? 0) + 1;
    if (flaws.length > 0 && refusals < MAX_REFUSED_BODIES) {
      this.refusedBodies.set(id, refusals);
      return this.refuse(`The file of the domain ${id} was not kept`, flaws);
    }
    const warning = this.shareWarning(id, elements);
    if (warning !== undefined) return warning;
    const byHarness = flaws.length > 0;
    this.kept.set(id, {
      domain,
      elements,
      body: byHarness ? minimalBody(elements) : body,
      writtenBy: byHarness ? "harness" : "model",
      ...(byHarness ? { refused: flaws.join(" "), refusedBody: body } : {}),
    });
    this.record(
      byHarness ? "error" : "info",
      byHarness
        ? `The harness wrote the file of the domain ${id} itself, after ${MAX_REFUSED_BODIES} bodies refused: ${this.masked(flaws.join(" "))}`
        : `The domain ${id} was kept with ${elements.length} elements.`,
    );
    return `The domain ${id} is kept with ${elements.length} elements${byHarness ? ", its file written by the harness" : ""}. ${this.left()}`;
  }

  private setAside(args: Record<string, unknown>): string | { error: string } {
    if (this.closed) return this.over();
    const reason = oneLine(args["reason"]);
    const given = Array.isArray(args["elements"]) ? (args["elements"] as readonly GivenElement[]) : [];
    const parts: Part[] = [];
    const problems = given.flatMap((element) => {
      const part = this.part(element);
      if (typeof part === "string") return [part];
      if (!this.options.watch.saw(part.file, part.section === undefined ? "titled" : "outlined"))
        return [
          `You saw nothing of ${part.name}. ${part.section === undefined ? `List its folder with ${this.tool("list_files")}` : `List the sections of ${part.file} with ${this.tool("list_sections")}`} before you set it aside.`,
        ];
      const domain = this.domainOf(part);
      if (domain !== undefined) return [`${part.name} is in the domain ${domain}: a document or a section is placed or set aside, not both.`];
      parts.push(part);
      return [];
    });
    if (given.length === 0) problems.push("Give in elements the documents, or the sections, to set aside.");
    if (reason === "" || reason.length > MAX_LINE_LENGTH) problems.push(`Give the reason in one sentence of ${MAX_LINE_LENGTH} characters at most.`);
    if (problems.length > 0) return this.refuse("Nothing was set aside", problems);
    for (const part of parts) this.aside.set(part.name, { ...part, reason });
    const names = parts.map((part) => part.name).join(", ");
    this.record("info", `${parts.length} documents or sections were set aside: ${names}. ${this.masked(reason)}`);
    return `${parts.length} documents or sections are set aside. ${this.left()}`;
  }

  /** What is wrong with a domain as it is declared; nothing when it can be kept. */
  private domainProblems({ id, label, description }: ManifestDomain): string[] {
    return [
      ...(SLUG.test(id)
        ? []
        : [`The domain id ${JSON.stringify(id)} is not a slug. Write lower case letters and digits separated by hyphens, such as "order-returns".`]),
      ...[label, description].flatMap((text, at) =>
        text === "" || text.length > MAX_LINE_LENGTH
          ? [`Give the ${at === 0 ? "label" : "description"} of the domain on one line of ${MAX_LINE_LENGTH} characters at most.`]
          : [],
      ),
    ];
  }

  /** A document or one of its sections, as the source holds it and the harness names it, or what is wrong with what the agent gave. */
  private part(given: GivenElement): Part | string {
    const file = String(given.file);
    const sections = this.options.sections.get(file);
    if (sections === undefined) return `${file} is no document of ${this.options.sourceId}. Use the paths ${this.tool("list_files")} gives.`;
    if (given.section === undefined) return { name: file, file };
    const section = sections.find((candidate) => candidate.number === given.section);
    if (section === undefined)
      return `${file} has no section ${JSON.stringify(given.section)}. Give a number ${this.tool("list_sections")} returns for it, or leave section out for the whole document.`;
    return { name: nameOf(file, section, sections), file, section };
  }

  /** An element as the source holds it, or what is wrong with it. */
  private async element(given: GivenElement, domain: string, before: readonly PlacedElement[]): Promise<PlacedElement | string> {
    const part = this.part(given);
    if (typeof part === "string") return part;
    const { name, file } = part;
    const role = oneLine(given.role);
    if (role === "" || role.length > MAX_LINE_LENGTH) return `Give the role of ${name} on one line of ${MAX_LINE_LENGTH} characters at most.`;
    if (this.aside.has(name)) return `${name} is set aside: a document or a section is placed or set aside, not both.`;
    if (!this.options.watch.saw(file, "outlined"))
      return `You looked at nothing of ${file} but its title. Call ${this.tool("list_sections")} or ${this.tool("read_file")} on it before you place it.`;
    if (before.some((other) => other.name === name)) return `${name} is given twice. Give each element once.`;
    const elsewhere = [...this.kept.values()].find((kept) => kept.domain.id !== domain && kept.elements.some((other) => other.name === name));
    if (elsewhere !== undefined) return `${name} is already in the domain ${elsewhere.domain.id}. Place an element in one domain.`;
    return { ...part, kind: kindOf(part), role, text: await this.text(part) };
  }

  /** The text of a part: that of its section, or of its whole document. */
  private async text(part: Part): Promise<string> {
    return part.section?.text ?? (await this.options.documents.read(part.file));
  }

  /** The question asked once about a domain of several documents the agent read the text of few of; nothing when enough were read, or it was asked. */
  private shareWarning(id: string, elements: readonly PlacedElement[]): string | undefined {
    const files = [...new Set(elements.map((element) => element.file))];
    const read = files.filter((file) => this.options.watch.saw(file, "read"));
    if (this.warned.has(id) || files.length < SHARE_FROM || read.length * 3 >= files.length) return undefined;
    this.warned.add(id);
    this.record("info", `The harness warned the agent that it read the text of ${read.length} of the ${files.length} documents of the domain ${id}.`);
    return `Warning: the domain ${id} is not kept yet. You read the text of ${read.length} of its ${files.length} documents, and only the titles of the others. Read those whose titles do not tell what they state, with ${this.tool("read_file")} or ${this.tool("read_section")}; if the titles tell enough, call ${WRITE_DOMAIN_TOOL} again with the same domain to confirm.`;
  }

  /**
   * What is in no domain and not set aside: a document nothing was said of, whole, and each section of a
   * document cut into sections that neither is covered nor holds a covered one, the largest first.
   */
  private remaining(): Part[] {
    const settled = [...[...this.kept.values()].flatMap((kept) => kept.elements), ...this.aside.values()];
    return this.options.files.flatMap(({ path: file }): Part[] => {
      const said = settled.filter((part) => part.file === file);
      if (said.length === 0) return [{ name: file, file }];
      if (said.some((part) => part.section === undefined)) return [];
      const sections = this.options.sections.get(file)!;
      // What a section holds runs to the next section of its level or above.
      const end = (at: number) => {
        const next = sections.findIndex((other, i) => i > at && other.level <= sections[at]!.level);
        return next === -1 ? sections.length : next;
      };
      const covered = new Set(said.flatMap((part) => sections.slice(part.section!.number - 1, end(part.section!.number - 1)).map((held) => held.number)));
      const left: Part[] = [];
      for (let at = 0; at < sections.length;) {
        const section = sections[at]!;
        const holds = sections.slice(at, end(at)).some((held) => covered.has(held.number));
        if (!holds) left.push({ name: nameOf(file, section, sections), file, section });
        at = covered.has(section.number) || !holds ? end(at) : at + 1;
      }
      return left;
    });
  }

  /** The domain a document or a section has an element in, if any: the element itself, or any element of the document for a whole one. */
  private domainOf(part: Part): string | undefined {
    const same = (element: PlacedElement) => (part.section === undefined ? element.file === part.file : element.name === part.name);
    return [...this.kept.values()].find((kept) => kept.elements.some(same))?.domain.id;
  }

  /** What is left to do, as every result ends. */
  private left(): string {
    const remaining = this.remaining();
    if (remaining.length === 0) return "The whole source is placed or set aside. Answer with one sentence; call no more tools.";
    const more = remaining.length > MAX_NAMED ? `, and ${remaining.length - MAX_NAMED} more` : "";
    const named = remaining.slice(0, MAX_NAMED).map((part) => (part.section === undefined ? part.name : `${part.name} (section ${part.section.number})`));
    return `${remaining.length} documents or sections are in no domain and not set aside: ${named.join(", ")}${more}. Next: place each with ${WRITE_DOMAIN_TOOL}, or set it aside with ${SET_ASIDE_TOOL}; a section that holds others covers them.`;
  }

  /** Refuses a call, and counts it: the last one closes the map. */
  private refuse(what: string, problems: readonly string[]): { error: string } {
    const told = problems.map((problem) => this.masked(problem));
    for (const problem of told) this.record("error", `${what}: ${problem}`);
    this.refused += 1;
    if (this.refused >= MAX_REFUSED_CALLS) {
      this.record("error", `The map of ${this.options.sourceId} was closed after ${MAX_REFUSED_CALLS} calls refused.`);
      return this.over();
    }
    return { error: [`Refused. ${what}. Fix what follows, and only that, then call the tool again.`, ...told.map((problem) => `- ${problem}`)].join("\n") };
  }

  private over(): { error: string } {
    return { error: "The map is closed: what is placed stays, and the rest will be asked again later. Answer with one sentence; call no more tools." };
  }

  private tool(action: string): string {
    return scopedToolName(this.options.sourceId, action);
  }

  private masked(text: string): string {
    return redactText(text, this.forms);
  }

  private record(level: "info" | "error", message: string): void {
    this.options.journal.record(level, message, this.options.sourceId);
  }
}

/** A text given by the agent, on one line; empty when it is none. */
function oneLine(text: unknown): string {
  return typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
}

/** What a part is, in one word. */
function kindOf(part: Part): "document" | "section" {
  return part.section === undefined ? "document" : "section";
}

/** The name of a section: its document, then its title, with its number when the title comes back in the document. */
function nameOf(file: string, section: DocumentSection, sections: readonly DocumentSection[]): string {
  const repeated = sections.filter((other) => other.title === section.title).length > 1;
  return `${file} § ${section.title}${repeated ? ` (§${section.number})` : ""}`;
}

/** An element of the map, as an element of the export: a document by its whole text, a section by its own. */
function draftOf({ name, kind, file, section, text }: PlacedElement): ElementDraft {
  const start = text.split("\n").slice(1).join(" ").replace(/\s+/g, " ").trim();
  const told = start.length <= START_LENGTH ? start : `${start.slice(0, START_LENGTH)}…`;
  return {
    name,
    kind,
    summary: [
      section === undefined ? `document ${file}` : `section ${section.title} of ${file} (level ${section.level}, §${section.number})`,
      ...(told === "" ? [] : [`starts: ${told}`]),
    ].join("\n  "),
    definition: text,
    names: [],
    links: [],
    file: exportFile(section === undefined ? "documents" : "sections", name, "md"),
  };
}
