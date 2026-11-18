import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after } from "node:test";

/** The identifiers of three runs, in the order they started. */
export const FIRST = "oqas-2026-11-14T09-00-00-000Z";
export const SECOND = "oqas-2026-11-14T10-00-00-000Z";
export const THIRD = "oqas-2026-11-14T11-00-00-000Z";

/** The date of an identifier, as the name of a trace ends on it, moved by some minutes. */
export function stampOf(id: string, minutes = 0): string {
  return id.slice("oqas-".length).replace(/-00-00-000Z$/, `-${String(minutes).padStart(2, "0")}-00-000Z`);
}

const folders: string[] = [];

after(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A temporary folder, removed once the tests of the file that asked for it are over. */
export function temporaryFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), "oqas-api-"));
  folders.push(folder);
  return folder;
}

/** A temporary test repository, as the runs of `oqas` leave it. */
export class TestRepository {
  /** The root of the repository, absolute. */
  readonly root: string;
  readonly #stateDir: string;

  /**
   * @param configuration - What `oqas.json` holds; no file when `undefined`.
   * @param stateDir - The state folder the runs write to, from the root.
   */
  constructor(configuration: unknown = { formatVersion: 1 }, stateDir = ".oqas") {
    this.root = temporaryFolder();
    this.#stateDir = stateDir;
    if (configuration !== undefined) writeFileSync(join(this.root, "oqas.json"), JSON.stringify(configuration));
  }

  /** The journal of a run, absolute. */
  journalPath(id: string): string {
    return join(this.root, this.#stateDir, "runs", `${id}.jsonl`);
  }

  /** The state of a run, absolute. */
  statePath(id: string): string {
    return join(this.root, this.#stateDir, "runs", `${id}.json`);
  }

  /** The trace of an agent, absolute. */
  tracePath(name: string, stamp: string): string {
    return join(this.root, this.#stateDir, "traces", `${name}-${stamp}.jsonl`);
  }

  /** Appends text to the journal of a run, which it starts when it has none. */
  journal(id: string, text: string): void {
    this.#append(this.journalPath(id), text);
  }

  /** Appends text to the trace of an agent, which it starts when it has none. */
  trace(name: string, stamp: string, text: string): void {
    this.#append(this.tracePath(name, stamp), text);
  }

  /** Writes any file of the state folder. */
  write(path: string, text: string): void {
    const file = join(this.root, this.#stateDir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }

  /** Ends a run: writes its state. */
  end(id: string, state: unknown): void {
    this.write(`runs/${id}.json`, JSON.stringify(state));
  }

  /** Dates the last write to a file. */
  touch(path: string, at: Date): void {
    utimesSync(path, at, at);
  }

  /** Removes a file. */
  remove(path: string): void {
    rmSync(path);
  }

  #append(file: string, text: string): void {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, text);
  }
}
