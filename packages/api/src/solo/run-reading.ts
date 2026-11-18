import { AppendedLines } from "./appended-lines.ts";
import { compareText } from "./compare-text.ts";
import { journalLine, traceLine } from "./run-lines.ts";
import { RunThread } from "./run-thread.ts";
import type { SessionEvent, SessionState } from "@open-qa-stack/shared/sessions";
import type { RunFolder } from "./run-folder.ts";
import type { RunLine } from "./run-line.ts";

/** A file of a run that is followed: what it gained, and its lines that are too recent to be told yet. */
interface FollowedFile {
  readonly appended: AppendedLines;
  waiting: RunLine[];
}

/**
 * The events of one run, read as the run writes them: each reading gives the events its journal and its
 * traces gained since the reading before, the traces it started since included.
 *
 * @remarks
 * The lines of every file are told together in the order of their dates; lines of the same date keep the
 * order of the files, the journal first, then the order they were written in. A reading only tells the lines
 * dated before its horizon, a margin before it began: a line dated later waits for a next reading, so that no
 * file can still gain a line that belongs before one already told, even when the run writes a line a moment
 * after the date it bears. The events are therefore numbered the same by every reading of the same files,
 * however the readings are paced.
 *
 * The end of the session, `completed` or `interrupted`, is told once: after every line, when the run has
 * been silent for the settle time.
 */
export class RunReading {
  readonly #folder: RunFolder;
  readonly #id: string;
  readonly #now: () => Date;
  readonly #settleMs: number;
  readonly #marginMs: number;
  readonly #followed = new Map<string, FollowedFile>();
  readonly #thread = new RunThread();
  #lastAt = "";
  #told: SessionState = "running";

  /**
   * @param folder - The test repository.
   * @param id - The identifier of the run.
   * @param now - The clock.
   * @param settleMs - How long the run must have been silent before the end of its session is told, in milliseconds.
   * @param marginMs - How long before a reading its horizon is, in milliseconds: the time the run is given to write a line it dated.
   */
  constructor(folder: RunFolder, id: string, now: () => Date, settleMs: number, marginMs: number) {
    this.#folder = folder;
    this.#id = id;
    this.#now = now;
    this.#settleMs = settleMs;
    this.#marginMs = marginMs;
  }

  /**
   * Reads what the run wrote since the last reading.
   *
   * @returns The new events, in order; none when nothing new can be told yet.
   * @throws When the repository no longer holds the run, at whatever moment of the reading its journal was removed.
   */
  async read(): Promise<SessionEvent[]> {
    const began = this.#now();
    const horizon = new Date(began.getTime() - this.#marginMs).toISOString();
    const files = await this.#folder.files(this.#id);
    if (files === undefined) throw this.#gone();
    const ready: RunLine[] = [];
    let waiting = 0;
    for (const [rank, path] of [files.journal, ...files.traces].entries()) {
      const file = this.#follow(path);
      const read = rank === 0 ? journalLine : traceLine;
      const lines = [...file.waiting, ...(await file.appended.read()).flatMap((text) => read(text) ?? [])];
      file.waiting = lines.filter((line) => line.at >= horizon);
      ready.push(...lines.filter((line) => line.at < horizon));
      waiting += file.waiting.length;
    }
    const events = ready.sort((a, b) => compareText(a.at, b.at)).flatMap((line) => this.#thread.add(line));
    this.#lastAt = ready.at(-1)?.at ?? this.#lastAt;
    const progress = await this.#folder.progress(files);
    // The journal was removed while this reading went on: the run is gone, not interrupted.
    if (progress === undefined) throw this.#gone();
    const { state, lastEventAt } = progress;
    if (state !== this.#told && waiting === 0 && Date.parse(lastEventAt) + this.#settleMs <= began.getTime()) {
      this.#told = state;
      events.push(this.#thread.changed(state, lastEventAt > this.#lastAt ? lastEventAt : this.#lastAt));
    }
    return events;
  }

  #gone(): Error {
    return new Error(`The test repository no longer holds the run ${this.#id}.`);
  }

  #follow(path: string): FollowedFile {
    const followed = this.#followed.get(path) ?? { appended: new AppendedLines(path), waiting: [] };
    this.#followed.set(path, followed);
    return followed;
  }
}
