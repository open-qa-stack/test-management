import { createHash } from "node:crypto";
import { fingerprintOf } from "./fingerprint.ts";

/** An element of a source as its export holds it: a table or a view of a database, for one. */
export interface ExportedElement {
  /** Its name, exactly as the source gives it; no other element of the export has it. */
  readonly name: string;
  /** What it is, in one word of the source: `table`, `view`. */
  readonly kind: string;
  /** What it holds in a few lines, enough to tell it from the others without reading its definition. */
  readonly summary: string;
  /** Its whole definition. */
  readonly definition: string;
  /** Fingerprint of its definition, which changes when the element does and only then. */
  readonly fingerprint: string;
  /** The names it declares: the columns of a table or of a view. */
  readonly names: readonly string[];
  /** Names of the other elements it refers to; one the export leaves out may be among them. */
  readonly links: readonly string[];
  /** File of its definition among those of the export, as a relative path with forward slashes. */
  readonly file: string;
}

/** An element whose fingerprint is not taken yet. */
export type ElementDraft = Omit<ExportedElement, "fingerprint">;

/** What a program read of a source, element by element, without the model. */
export interface SourceExport {
  /** The elements, in a stable order. */
  readonly elements: readonly ExportedElement[];
  /** Fingerprint of the source: that of the fingerprints of its elements, in their order. */
  readonly fingerprint: string;
}

/** Longest name kept as it is in the name of a file. */
const PLAIN_NAME = /^[a-z0-9._-]{1,120}$/;

/**
 * Fingerprints the elements of an export, then the export itself.
 *
 * @param drafts - The elements, in a stable order.
 * @returns The export.
 */
export function sourceExport(drafts: readonly ElementDraft[]): SourceExport {
  const elements = drafts.map((draft) => ({ ...draft, fingerprint: fingerprintOf(draft.definition) }));
  return { elements, fingerprint: fingerprintOf(elements.map((element) => element.fingerprint).join("\n")) };
}

/**
 * Names the file of an element in an export.
 *
 * @remarks
 * A name of lower-case letters, digits, dots, hyphens and underscores, 120 characters at most, is kept as it
 * is. Any other has each run of other characters replaced by an underscore, is cut to 120 characters and is
 * followed by a digest of the whole name: no name leaves its folder, and two names never share a file, even
 * where the file system ignores case.
 *
 * @param folder - Folder of the elements of this kind, in the export.
 * @param name - Name of the element.
 * @param extension - Extension of the file, without its dot.
 * @returns The path of the file in the export, with forward slashes.
 */
export function exportFile(folder: string, name: string, extension: string): string {
  const digest = createHash("sha256").update(name).digest("hex").slice(0, 8);
  const base = PLAIN_NAME.test(name) ? name : `${name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120)}-${digest}`;
  return `${folder}/${base}.${extension}`;
}
