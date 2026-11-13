import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { redactText, secretForms } from "@open-qa-stack/tools";

/** A step of the solo command, in the order they run. */
export type Step = "configuration" | "prerequisites" | "cartography" | "design" | "execution" | "summary";

/** An entry of the journal of a run. */
export interface RunEntry {
  /** When it happened, as an ISO 8601 date. */
  readonly at: string;
  readonly step: Step;
  /** `started` and `finished` frame each step; `info` and `error` tell what happened in it. */
  readonly event: "started" | "finished" | "info" | "error";
  readonly message: string;
  /** For `finished`: how long the step took, in milliseconds. */
  readonly durationMs?: number;
  /** For `finished`: how many requests the step sent to the model. */
  readonly modelRequests?: number;
}

/** Where the journal writes: a stream a person reads, and a clock. */
export interface JournalOutput {
  /** Receives each entry as a line a person reads; the error output of the command. */
  readonly write: (line: string) => void;
  readonly now: () => Date;
}

/**
 * The journal of a run of the solo command: each entry is written as a line on the error output, and, once
 * the file of the run is known, as a JSON line in it. Every secret is masked, in every form.
 */
export class RunJournal {
  private readonly output: JournalOutput;
  private readonly forms: readonly string[];
  private readonly kept: RunEntry[] = [];
  private file: string | undefined;

  /**
   * @param output - Where the lines go, and the clock.
   * @param secrets - The values masked in every entry.
   */
  public constructor(output: JournalOutput, secrets: readonly string[]) {
    this.output = output;
    this.forms = secrets.filter((secret) => secret !== "").flatMap(secretForms);
  }

  /**
   * The entries written so far.
   *
   * @returns A copy, in order.
   */
  public get entries(): RunEntry[] {
    return [...this.kept];
  }

  /**
   * Takes the entries another journal already wrote to the output, so that the file holds them too.
   *
   * @param entries - The entries, in order.
   */
  public adopt(entries: readonly RunEntry[]): void {
    this.kept.push(...entries.map((entry) => ({ ...entry, message: this.mask(entry.message) })));
  }

  /**
   * Masks every secret in a text, in every form.
   *
   * @param text - The text.
   * @returns It, each secret replaced.
   */
  public mask(text: string): string {
    return redactText(text, this.forms);
  }

  /**
   * Writes the entries to a JSON Lines file from now on, the earlier ones first.
   *
   * @param path - The file, made with its folder.
   */
  public keepIn(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    this.file = path;
    for (const entry of this.kept) appendFileSync(path, `${JSON.stringify(entry)}\n`);
  }

  /**
   * Writes an entry.
   *
   * @param step - The step it belongs to.
   * @param event - What it is.
   * @param message - What happened, in a sentence.
   * @param counts - For `finished`, the duration and the requests to the model.
   */
  public record(step: Step, event: RunEntry["event"], message: string, counts: Pick<RunEntry, "durationMs" | "modelRequests"> = {}): void {
    const entry: RunEntry = { at: this.output.now().toISOString(), step, event, message: this.mask(message), ...counts };
    this.kept.push(entry);
    const figures = [
      counts.durationMs === undefined ? undefined : `${Math.round(counts.durationMs / 100) / 10} s`,
      counts.modelRequests === undefined ? undefined : `${counts.modelRequests} model requests`,
    ].filter((figure) => figure !== undefined);
    this.output.write(`[${step}] ${event === "info" ? "" : `${event}: `}${entry.message}${figures.length === 0 ? "" : ` (${figures.join(", ")})`}\n`);
    if (this.file !== undefined) appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
  }
}
