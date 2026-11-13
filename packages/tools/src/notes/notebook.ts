import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

/** A fact an agent kept for the agents that come after it. */
export interface Note {
  /** What the agent learned, in a few sentences. */
  readonly text: string;
  /** Words that file the note, in lower case. */
  readonly tags: readonly string[];
  /** The knowledge source or application it is about, when there is one. */
  readonly source?: string;
  /** The role of the agent that wrote it: `cartographer`, `designer`… */
  readonly role: string;
  /** The task that wrote it. */
  readonly task: string;
  /** Date and time it was written, ISO 8601 in UTC. */
  readonly writtenAt: string;
}

/** A note found by a search, and how well it matches. */
export interface FoundNote extends Note {
  /** Two points per tag in common, one per word of the query found in the text. */
  readonly score: number;
}

/** What to look for among the notes. */
export interface NoteQuery {
  /** Notes that bear one of these tags match. */
  readonly tags?: readonly string[];
  /** Notes whose text holds one of these words match. */
  readonly text?: string;
  /** Notes about this source only. */
  readonly source?: string;
  /** Most notes to return. */
  readonly limit: number;
}

/**
 * The notes of the agents of a test repository, kept in a file of one JSON note per line.
 *
 * @remarks
 * A note is only ever added, never changed. A search ranks the notes by tags in common, then by words of
 * the query found in their text, the latest first on a tie; without tags nor text, it gives the latest
 * notes. Lines that are not notes are skipped.
 */
export class Notebook {
  private readonly path: string;

  /** @param path - The file of the notes; it is created with its folder at the first note. */
  public constructor(path: string) {
    this.path = path;
  }

  /**
   * Adds a note.
   *
   * @param note - The note.
   * @throws Error when the file cannot be written.
   */
  public async add(note: Note): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(note)}\n`);
  }

  /**
   * Finds notes.
   *
   * @param query - What to look for.
   * @returns The matching notes, the best first.
   * @throws Error when the file exists but cannot be read.
   */
  public async find(query: NoteQuery): Promise<FoundNote[]> {
    const notes = (await this.all()).filter((note) => query.source === undefined || note.source === query.source);
    const tags = new Set((query.tags ?? []).map((tag) => tag.toLowerCase()));
    const words = wordsOf(query.text ?? "");
    const open = tags.size === 0 && words.size === 0;
    return notes
      .map((note, position) => {
        const inText = wordsOf(note.text);
        const score = 2 * note.tags.filter((tag) => tags.has(tag)).length + [...words].filter((word) => inText.has(word)).length;
        return { note: { ...note, score }, position };
      })
      .filter(({ note }) => open || note.score > 0)
      .sort((a, b) => b.note.score - a.note.score || b.position - a.position)
      .slice(0, query.limit)
      .map(({ note }) => note);
  }

  private async all(): Promise<Note[]> {
    const text = await readFile(this.path, "utf8").catch((failure: NodeJS.ErrnoException) => {
      if (failure.code === "ENOENT") return "";
      throw failure;
    });
    return text.split("\n").flatMap((line) => {
      try {
        const note = JSON.parse(line) as Note;
        return typeof note.text === "string" && Array.isArray(note.tags) ? [note] : [];
      } catch {
        return [];
      }
    });
  }
}

/** The words of a text worth matching: three letters or more, in lower case. */
function wordsOf(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((word) => word.length >= 3));
}
