import { realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fingerprintOf } from "../common/fingerprint.ts";
import { CodeFolder } from "../source-code/code-folder.ts";
import { documentSections, type DocumentSection } from "./document-sections.ts";

/** The readers of the formats a folder of documents is read in, by the extension of a file, in lower case. */
const READERS: Readonly<Record<string, (text: string) => DocumentSection[]>> = { ".md": documentSections, ".markdown": documentSections };

/** A document of a source, as a listing gives it: enough to choose what to open. */
export interface DocumentFile {
  /** Its path in the source, with `/`. */
  readonly path: string;
  /** Its first heading, when it has one. */
  readonly title?: string;
  /** How many headings it holds. */
  readonly headings: number;
  /** Its length, in characters. */
  readonly chars: number;
}

/** What a source of documents holds. */
export interface DocumentListing {
  /** The documents a reader reads, in alphabetical order. */
  readonly files: readonly DocumentFile[];
  /** The other files, which no reader reads: their paths. */
  readonly unreadable: readonly string[];
  /** Whether the scan stopped before the end of the folder. */
  readonly truncated: boolean;
}

/**
 * The documents of a knowledge source: one file, or every file of a folder, read without ever leaving it.
 *
 * @remarks
 * A source declared as a file is that file, read as Markdown whatever its extension. A source declared as a
 * folder is the files under it that a reader reads, by their extension — Markdown, the one format read so
 * far; the others are listed apart, and never read. A document is read as its sections, whatever its
 * format: another format needs its reader only. Paths are relative to the folder, or to the folder of the
 * file, with `/`.
 */
export class DocumentSet {
  private readonly repositoryRoot: string;
  private readonly path: string;
  private readonly maxScanned: number | undefined;
  private located: Promise<{ readonly folder: CodeFolder; readonly only?: string }> | undefined;

  /**
   * @param repositoryRoot - Absolute path of the test repository.
   * @param path - Path of the file or of the folder, relative to the repository root.
   * @param maxScanned - Most files one listing of a folder looks at; that of a folder of source code by default.
   */
  public constructor(repositoryRoot: string, path: string, maxScanned?: number) {
    this.repositoryRoot = repositoryRoot;
    this.path = path;
    this.maxScanned = maxScanned;
  }

  /**
   * Lists the documents of the source.
   *
   * @returns Its documents, each with its title, its number of headings and its length, and the files no reader reads.
   * @throws Error when the source does not exist.
   */
  public async list(): Promise<DocumentListing> {
    const { folder, only } = await this.location();
    const listed = only === undefined ? await folder.list() : { files: [only], truncated: false };
    const readable = listed.files.filter((path) => only !== undefined || READERS[extname(path).toLowerCase()] !== undefined);
    const files = await Promise.all(
      readable.map(async (path) => {
        const [text, sections] = await Promise.all([this.read(path), this.sections(path)]);
        return { path, ...(sections[0] === undefined ? {} : { title: sections[0].title }), headings: sections.length, chars: text.length };
      }),
    );
    return { files, unreadable: listed.files.filter((path) => !readable.includes(path)), truncated: listed.truncated };
  }

  /**
   * Reads a document.
   *
   * @param path - Its path in the source; the one document of a source declared as a file when left out.
   * @returns Its text.
   * @throws Error when the path leads outside the source, is no file of it or cannot be read.
   */
  public async read(path?: string): Promise<string> {
    const { folder, only } = await this.location();
    const file = path ?? only;
    if (file === undefined) throw new Error("Give the file to read: the source holds several documents.");
    if (only !== undefined && file !== only) throw new Error(`${file} is no document of the source, which is the file ${only}.`);
    return folder.read(file);
  }

  /**
   * Reads the sections of a document.
   *
   * @param path - Its path in the source; the one document of a source declared as a file when left out.
   * @returns Its sections, in order.
   * @throws Error when the document cannot be read, or no reader reads its format.
   */
  public async sections(path?: string): Promise<DocumentSection[]> {
    const { only } = await this.location();
    const text = await this.read(path);
    // The one document of a source declared as a file is read as Markdown, whatever its name.
    const reader = only === undefined ? READERS[extname(path!).toLowerCase()] : documentSections;
    if (reader === undefined) throw new Error(`No reader reads ${path}: only Markdown documents are read.`);
    return reader(text);
  }

  /**
   * Fingerprints the source.
   *
   * @returns The fingerprint of the paths and the texts of its documents, which changes when one does.
   * @throws Error when the source does not exist.
   */
  public async fingerprint(): Promise<string> {
    const { files } = await this.list();
    const texts = await Promise.all(files.map(async ({ path }) => `${path}\n${fingerprintOf(await this.read(path))}`));
    return fingerprintOf(texts.join("\n"));
  }

  /** Where the documents are: the folder declared, or the folder of the file declared and that file alone; never outside the test repository. */
  private location(): Promise<{ readonly folder: CodeFolder; readonly only?: string }> {
    this.located ??= this.locate().catch((failure: unknown) => {
      this.located = undefined;
      throw failure;
    });
    return this.located;
  }

  private async locate(): Promise<{ readonly folder: CodeFolder; readonly only?: string }> {
    const root = await realpath(this.repositoryRoot);
    const declared = await realpath(resolve(root, this.path)).catch(() => {
      throw new Error(`The document ${this.path} does not exist.`);
    });
    const inside = relative(root, declared);
    if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
      throw new Error(`The document ${this.path} leads outside the test repository.`);
    const found = await stat(declared);
    return found.isDirectory()
      ? { folder: new CodeFolder(declared, this.maxScanned) }
      : { folder: new CodeFolder(dirname(declared)), only: basename(declared) };
  }
}
