import { AppendedLines } from "./appended-lines.ts";
import { briefOf, traceLine } from "./run-lines.ts";

/**
 * The search for the brief of a run in its traces, which the harness quotes once the agent that plans starts.
 *
 * @remarks
 * A run is described at every listing of the sessions, and a run interrupted before its plan never quotes its
 * brief. Each trace is therefore read once: a search only reads what the traces gained since the search
 * before, and a brief that was found is kept.
 */
export class BriefSearch {
  readonly #traces = new Map<string, AppendedLines>();
  #brief: string | undefined;

  /**
   * Looks for the brief in what the traces gained since the last search.
   *
   * @param traces - The traces of the run, absolute, in the order they started.
   * @returns The brief, once a trace quoted it; `undefined` until then.
   */
  async in(traces: readonly string[]): Promise<string | undefined> {
    for (const path of traces) {
      if (this.#brief !== undefined) break;
      const trace = this.#traces.get(path) ?? new AppendedLines(path);
      this.#traces.set(path, trace);
      for (const text of await trace.read()) {
        const line = traceLine(text);
        this.#brief ??= line === undefined ? undefined : briefOf(line);
      }
    }
    return this.#brief;
  }
}
