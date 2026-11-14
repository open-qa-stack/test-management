import { exportFile, scopedToolName, type DocumentFile, type DocumentSection, type DocumentSet, type ElementDraft } from "@open-qa-stack/tools";
import { HandedInMap, type HandedInMapOptions, type MapPart, type PlacedPart } from "../source-workflow/handed-in-map.ts";
import type { DocumentWatch } from "./document-watch.ts";

/** Fewest documents of a domain from which the harness asks whether enough of them were read. */
const SHARE_FROM = 3;
/** Longest start of a section its summary keeps, in characters. */
const START_LENGTH = 300;

/** A part of the source: a whole document, or one of its sections with the sections it holds. */
interface DocumentPart extends MapPart {
  readonly kind: "document" | "section";
  readonly file: string;
  /** The section, for a part that is one; the whole document otherwise. */
  readonly section?: DocumentSection;
}

/** What a map of documents needs. */
export interface DocumentMapOptions extends HandedInMapOptions {
  /** The documents of the source. */
  readonly documents: DocumentSet;
  /** The documents a reader reads, as their listing gives them. */
  readonly files: readonly DocumentFile[];
  /** The sections of each document, by its path. */
  readonly sections: ReadonlyMap<string, readonly DocumentSection[]>;
  /** What the agent saw of them. */
  readonly watch: DocumentWatch;
}

/**
 * The map of the documents of a source, as the agent that reads them hands it in, domain by domain.
 *
 * @remarks
 * An element is a whole document, by its path, or one of its sections, by its path and its title. The
 * harness holds what is handed in to what the agent looked at: a document is placed once the agent listed
 * its sections or read it, and set aside once it saw its title; a section is set aside once the agent
 * listed the sections of its document. It warns, once per domain, when the agent read the text of less than
 * a third of the documents of a domain of `SHARE_FROM` or more: the same call again confirms that their
 * titles told enough.
 *
 * The map is over once the whole source is covered, and not before. A document is covered when it is placed
 * or set aside whole. One the agent cut into sections is covered section by section: a section is covered
 * by itself or by one that holds it, and each section left that holds none covered is still to place or to
 * set aside, the largest first. What comes before the first heading of a document, and the lines of a
 * section before its first covered sub-section, are not counted. What every map does besides is that of
 * `HandedInMap`.
 */
export class DocumentMap extends HandedInMap<DocumentPart> {
  private readonly documents: DocumentSet;
  private readonly files: readonly DocumentFile[];
  private readonly sections: ReadonlyMap<string, readonly DocumentSection[]>;
  private readonly watch: DocumentWatch;

  /** @param options - What the map needs. */
  public constructor(options: DocumentMapOptions) {
    const file = { type: "string", description: "Path of the document, as list_files gives it." };
    const section = { type: "integer", minimum: 1, description: "Number of the section, as list_sections gives it; left out for the whole document." };
    super(options, {
      things: "documents or sections",
      one: "a document or a section",
      given: { properties: { file, section }, required: ["file"] },
      write:
        "Hands one functional domain in: its elements, each a document or one of its sections with its role, then the markdown body of its file, which names every element between backticks. A domain handed in again replaces what was kept of it.",
      aside:
        "Sets aside what serves no functional area, with why: whole documents, such as a change log, or sections of a document, such as its glossary. They stay in the source, in no domain.",
      noElement: "The domain has no element. Give its documents, or their sections, in elements.",
      noAside: "Give in elements the documents, or the sections, to set aside.",
      hint: "; a section that holds others covers them",
    });
    this.documents = options.documents;
    this.files = options.files;
    this.sections = options.sections;
    this.watch = options.watch;
  }

  /** {@inheritDoc HandedInMap.part} */
  protected part(given: Readonly<Record<string, unknown>>): DocumentPart | string {
    const file = String(given["file"]);
    const sections = this.sections.get(file);
    if (sections === undefined) return `${file} is no document of ${this.sourceId}. Use the paths ${this.tool("list_files")} gives.`;
    if (given["section"] === undefined) return { name: file, kind: "document", file };
    const section = sections.find((candidate) => candidate.number === given["section"]);
    if (section === undefined)
      return `${file} has no section ${JSON.stringify(given["section"])}. Give a number ${this.tool("list_sections")} returns for it, or leave section out for the whole document.`;
    return { name: nameOf(file, section, sections), kind: "section", file, section };
  }

  /** {@inheritDoc HandedInMap.placeProblem} */
  protected placeProblem({ file }: DocumentPart): string | undefined {
    return this.watch.saw(file, "outlined")
      ? undefined
      : `You looked at nothing of ${file} but its title. Call ${this.tool("list_sections")} or ${this.tool("read_file")} on it before you place it.`;
  }

  /** {@inheritDoc HandedInMap.asideProblem} */
  protected asideProblem(part: DocumentPart): string | undefined {
    if (this.watch.saw(part.file, part.section === undefined ? "titled" : "outlined")) return undefined;
    const look =
      part.section === undefined ? `List its folder with ${this.tool("list_files")}` : `List the sections of ${part.file} with ${this.tool("list_sections")}`;
    return `You saw nothing of ${part.name}. ${look} before you set it aside.`;
  }

  /**
   * What is in no domain and not set aside: a document nothing was said of, whole, and each section of a
   * document cut into sections that neither is covered nor holds a covered one, the largest first.
   */
  protected remaining(settled: readonly DocumentPart[]): DocumentPart[] {
    return this.files.flatMap(({ path: file }): DocumentPart[] => {
      const said = settled.filter((part) => part.file === file);
      if (said.length === 0) return [{ name: file, kind: "document", file }];
      if (said.some((part) => part.section === undefined)) return [];
      const sections = this.sections.get(file)!;
      // What a section holds runs to the next section of its level or above.
      const end = (at: number) => {
        const next = sections.findIndex((other, i) => i > at && other.level <= sections[at]!.level);
        return next === -1 ? sections.length : next;
      };
      const covered = new Set(said.flatMap((part) => sections.slice(part.section!.number - 1, end(part.section!.number - 1)).map((held) => held.number)));
      const left: DocumentPart[] = [];
      for (let at = 0; at < sections.length;) {
        const section = sections[at]!;
        const holds = sections.slice(at, end(at)).some((held) => covered.has(held.number));
        if (!holds) left.push({ name: nameOf(file, section, sections), kind: "section", file, section });
        at = covered.has(section.number) || !holds ? end(at) : at + 1;
      }
      return left;
    });
  }

  /** {@inheritDoc HandedInMap.text} */
  protected async text(part: DocumentPart): Promise<string> {
    return part.section?.text ?? (await this.documents.read(part.file));
  }

  /** An element of the map, as an element of the export: a document by its whole text, a section by its own. */
  protected draft({ name, kind, file, section }: DocumentPart, text: string): ElementDraft {
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

  /** A whole document is in a domain once any of its sections is: it is not set aside then. */
  protected held(part: DocumentPart, element: DocumentPart): boolean {
    return part.section === undefined ? element.file === part.file : element.name === part.name;
  }

  /** A section left is named with its number, which the agent gives to place it. */
  protected called(part: DocumentPart): string {
    return part.section === undefined ? part.name : `${part.name} (section ${part.section.number})`;
  }

  /** A domain of documents is handed in with its elements and its body, and nothing else. */
  protected more(): Readonly<Record<string, unknown>> {
    return {};
  }

  /** {@inheritDoc HandedInMap.extra} */
  protected extra(): { readonly problems: readonly string[]; readonly added: string } {
    return { problems: [], added: "" };
  }

  /** The question asked once about a domain of several documents the agent read the text of few of; nothing when enough were read. */
  protected question(id: string, elements: readonly PlacedPart<DocumentPart>[]): string | undefined {
    const files = [...new Set(elements.map((element) => element.file))];
    const read = files.filter((file) => this.watch.saw(file, "read"));
    if (files.length < SHARE_FROM || read.length * 3 >= files.length) return undefined;
    this.record("info", `The harness warned the agent that it read the text of ${read.length} of the ${files.length} documents of the domain ${id}.`);
    return `Warning: the domain ${id} is not kept yet. You read the text of ${read.length} of its ${files.length} documents, and only the titles of the others. Read those whose titles do not tell what they state, with ${this.tool("read_file")} or ${this.tool("read_section")}; if the titles tell enough, call write_domain again with the same domain to confirm.`;
  }

  /** The name of a tool of the documents of the source. */
  private tool(action: string): string {
    return scopedToolName(this.sourceId, action);
  }
}

/** The name of a section: its document, then its title, with its number when the title comes back in the document. */
function nameOf(file: string, section: DocumentSection, sections: readonly DocumentSection[]): string {
  const repeated = sections.filter((other) => other.title === section.title).length > 1;
  return `${file} § ${section.title}${repeated ? ` (§${section.number})` : ""}`;
}
