import { configError, pointer } from "../config/errors.ts";
import type { ConfigError } from "../config/types.ts";
import type { DocumentEntry } from "./stored-document.ts";

/** Largest document a source holds, in bytes: the largest file the reading tools of the agents read. */
export const MAX_DOCUMENT_BYTES = 1_000_000;

/** Most documents one upload holds. */
export const MAX_DOCUMENTS_PER_UPLOAD = 20;

/** Longest file name of a document, in characters. */
export const MAX_DOCUMENT_NAME_LENGTH = 200;

/** The extensions of the documents a source holds, in lower case: those of Markdown, the format the agents read. */
export const DOCUMENT_EXTENSIONS: readonly string[] = Object.freeze([".md", ".markdown"]);

/** A file as it is uploaded, before anything is read of it. */
export interface UploadedFile {
  /** Its file name, as the client gave it. */
  readonly name: string;
  /** Its size, in bytes. */
  readonly bytes: number;
}

/** A file as it is uploaded, with what was received of its content. */
export interface ReceivedFile extends UploadedFile {
  readonly content: Uint8Array;
}

/** What an upload is read as: its documents, or every error found. */
export type UploadReading = { readonly ok: true; readonly entries: DocumentEntry[] } | { readonly ok: false; readonly errors: ConfigError[] };

/** The code units no file name holds besides the control characters: the slash and the backslash. */
const SEPARATORS: ReadonlySet<number> = new Set([0x2f, 0x5c]);

/** Whether a file name holds a control character or a separator of folders. */
function holdsForbidden(name: string): boolean {
  for (let index = 0; index < name.length; index++) {
    const code = name.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || SEPARATORS.has(code)) return true;
  }
  return false;
}

/** The error of a file name a source refuses; none for a name it takes. */
function nameError(path: string, name: string): ConfigError | undefined {
  const refused = (rule: string, message: string) => configError("structure", path, rule, message);
  if (name.length === 0 || name.length > MAX_DOCUMENT_NAME_LENGTH || name.startsWith(".") || holdsForbidden(name))
    return refused(
      "document-name",
      `Expected a file name of ${MAX_DOCUMENT_NAME_LENGTH} characters at most, which does not start with a dot and holds no slash and no control character.`,
    );
  const dot = name.lastIndexOf(".");
  if (dot === -1 || !DOCUMENT_EXTENSIONS.includes(name.slice(dot).toLowerCase()))
    return refused("document-format", `Only Markdown documents are read: expected a file name that ends with ${DOCUMENT_EXTENSIONS.join(" or ")}.`);
  return undefined;
}

/**
 * Checks the files of an upload before their contents are read: how many there are, their names, their formats
 * and their sizes.
 *
 * @param files - The files, in the order of the upload.
 * @returns Every error found, each at the file it is about, `/documents/<rank>`; at the upload, `""`, for one that
 * holds no file or too many. None when the upload is in order.
 */
export function uploadErrors(files: readonly UploadedFile[]): ConfigError[] {
  if (files.length === 0) return [configError("structure", "", "no-documents", "Upload one document at least.")];
  if (files.length > MAX_DOCUMENTS_PER_UPLOAD)
    return [configError("structure", "", "too-many-documents", `Upload ${MAX_DOCUMENTS_PER_UPLOAD} documents at most at once.`)];
  return files.flatMap(({ name, bytes }, rank) => {
    const path = pointer("/documents", rank);
    const error = nameError(path, name);
    if (error !== undefined) return [error];
    if (files.findIndex((other) => other.name === name) < rank) return [configError("structure", path, "duplicate", "Duplicate document name.")];
    return bytes > MAX_DOCUMENT_BYTES ? [configError("structure", path, "document-size", `A document holds ${MAX_DOCUMENT_BYTES} bytes at most.`)] : [];
  });
}

/**
 * Reads the files of an upload as documents, once they are in order: each is text, in UTF-8.
 *
 * @param files - The files, in the order of the upload, each with what was received of its content.
 * @returns The documents, each with its text; or every error found, as {@link uploadErrors} finds them, or at a
 * file that is not text in UTF-8.
 */
export function readUpload(files: readonly ReceivedFile[]): UploadReading {
  const errors = uploadErrors(files);
  if (errors.length > 0) return { ok: false, errors };
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  const entries: DocumentEntry[] = [];
  files.forEach(({ name, content }, rank) => {
    try {
      entries.push({ name, text: decoder.decode(content) });
    } catch {
      errors.push(configError("structure", pointer("/documents", rank), "document-encoding", "Expected a text in UTF-8."));
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, entries };
}
