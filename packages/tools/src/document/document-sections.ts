/** A section of a document: a heading and the text under it, down to the next heading of the same or a higher level. */
export interface DocumentSection {
  /** Position of the heading in the document, from 1; what the read tool asks for. */
  readonly number: number;
  readonly title: string;
  readonly level: number;
  readonly text: string;
}

/** A heading of the ATX kind, its level in the first group and its text in the second. */
const HEADING = /^ {0,3}(#{1,6})\s+(\S.*)/;
/** The closing sequence of a heading, which follows a space. */
const CLOSING = /\s#+$/;
const FENCE = /^ {0,3}(```|~~~)/;

/**
 * Splits a Markdown document into its sections.
 *
 * @remarks
 * Headings inside fenced code blocks are not headings. Text before the first heading belongs to no
 * section.
 *
 * @param markdown - The document.
 * @returns Its sections, in order.
 */
export function documentSections(markdown: string): DocumentSection[] {
  const lines = markdown.split("\n");
  const headings: { line: number; level: number; title: string }[] = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (FENCE.test(line)) fenced = !fenced;
    const heading = fenced ? null : HEADING.exec(line);
    if (heading !== null) headings.push({ line: index, level: heading[1]!.length, title: heading[2]!.trimEnd().replace(CLOSING, "").trimEnd() });
  });
  return headings.map((heading, i) => {
    const next = headings.slice(i + 1).find((h) => h.level <= heading.level);
    const text = lines
      .slice(heading.line, next?.line ?? lines.length)
      .join("\n")
      .trim();
    return { number: i + 1, title: heading.title, level: heading.level, text };
  });
}
