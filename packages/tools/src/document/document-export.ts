import { exportFile, sourceExport, type ElementDraft, type SourceExport } from "../common/source-export.ts";
import type { DocumentSection } from "./document-sections.ts";

/** Longest start of a section its summary keeps, in characters. */
export const SECTION_START_LENGTH = 300;

/** A section of a document that is an element of its export, under the name that tells it from the others. */
export interface NamedSection {
  readonly name: string;
  readonly section: DocumentSection;
}

/**
 * The sections of a document that are the elements of its export.
 *
 * @remarks
 * They are its sections of the two highest levels it has — chapters and their sections, whether the document
 * starts at its first or at its second level of heading. Each is named by its title; a title that comes
 * back is followed by its number, as `Overview (§7)`, so that every name is unique.
 *
 * @param sections - The sections of the document, in order, as the reader of its format gives them.
 * @returns Those kept, each with its name.
 */
export function namedSections(sections: readonly DocumentSection[]): NamedSection[] {
  const levels = [...new Set(sections.map((section) => section.level))].sort((a, b) => a - b).slice(0, 2);
  const kept = sections.filter((section) => levels.includes(section.level));
  const repeated = new Set(kept.filter((section, i) => kept.findIndex((other) => other.title === section.title) !== i).map((section) => section.title));
  return kept.map((section) => ({ name: repeated.has(section.title) ? `${section.title} (§${section.number})` : section.title, section }));
}

/**
 * Exports a document, section by section, whatever the format it was read from.
 *
 * @remarks
 * The elements are the sections `namedSections` keeps, in the order of the document. A section of the
 * lower of the two levels is defined by its whole text, the deeper sections it holds included; the titles
 * of those are its names. A chapter is defined by its own text, down to its first section, each of which is
 * an element of its own: its summary lists them. A section links to its chapter. The summary of an element
 * gives its level, its number, its chapter and the start of its text, on one line.
 *
 * @param sections - The sections of the document, in order, as the reader of its format gives them.
 * @returns The export of the document.
 */
export function documentExport(sections: readonly DocumentSection[]): SourceExport {
  const named = namedSections(sections);
  const chapterLevel = Math.min(...named.map(({ section }) => section.level));
  const drafts = named.map(({ name, section }, at): ElementDraft => {
    const chapter = section.level === chapterLevel ? undefined : named.slice(0, at).findLast((other) => other.section.level === chapterLevel);
    // What a section holds runs to the next section of its level or above.
    const end = sections.findIndex((other) => other.number > section.number && other.level <= section.level);
    const inside = sections.slice(section.number, end === -1 ? sections.length : end);
    const children = named.filter((other) => inside.includes(other.section));
    const definition = children.length === 0 ? section.text : section.text.slice(0, section.text.indexOf(children[0]!.section.text)).trimEnd();
    const start = definition.split("\n").slice(1).join(" ").replace(/\s+/g, " ").trim();
    const deeper = children.length === 0 ? inside.map((other) => other.title) : [];
    const summary = [
      `section ${name} (level ${section.level}, §${section.number}${chapter === undefined ? "" : `, in ${chapter.name}`})`,
      ...(start === "" ? [] : [`starts: ${start.length <= SECTION_START_LENGTH ? start : `${start.slice(0, SECTION_START_LENGTH)}…`}`]),
      ...(children.length === 0 ? [] : [`sections: ${children.map((child) => child.name).join("; ")}`]),
      ...(deeper.length === 0 ? [] : [`headings: ${deeper.join("; ")}`]),
    ];
    return {
      name,
      kind: "section",
      summary: summary.join("\n  "),
      definition,
      names: deeper,
      links: chapter === undefined ? [] : [chapter.name],
      file: exportFile("sections", name, "md"),
    };
  });
  return sourceExport(drafts);
}
