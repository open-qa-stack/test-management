import { redactText, secretForms } from "@open-qa-stack/tools";
import type { RunEntry, Step } from "@open-qa-stack/domain";
import type { JournalOutput } from "../ports/journal-output.ts";
import type { RunReference } from "../ports/run-reference.ts";

/**
 * The journal of a run: each entry is dated, has every secret masked, in every form, and goes to the output
 * the host of the engine gives.
 */
export class RunJournal {
  private readonly output: JournalOutput;
  private readonly now: () => Date;
  private readonly forms: readonly string[];
  private readonly written: RunEntry[] = [];

  /**
   * @param output - Where the entries go.
   * @param now - The clock.
   * @param secrets - The values masked in every entry.
   */
  public constructor(output: JournalOutput, now: () => Date, secrets: readonly string[]) {
    this.output = output;
    this.now = now;
    this.forms = secrets.filter((secret) => secret !== "").flatMap(secretForms);
  }

  /**
   * The entries written so far.
   *
   * @returns A copy, in order.
   */
  public get entries(): RunEntry[] {
    return [...this.written];
  }

  /**
   * Takes the entries another journal already wrote to the output, so that what is kept of the run holds them too.
   *
   * @param entries - The entries, in order.
   */
  public adopt(entries: readonly RunEntry[]): void {
    this.written.push(...entries.map((entry) => ({ ...entry, message: this.mask(entry.message) })));
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
   * Has the output keep the journal of the run from now on, the entries written so far first.
   *
   * @param run - The run.
   */
  public keep(run: RunReference): void {
    this.output.keep(run, this.entries);
  }

  /**
   * Writes an entry.
   *
   * @param step - The step it belongs to.
   * @param event - What it is.
   * @param message - What happened, in a sentence.
   * @param facts - For `finished`, the duration and the requests to the model, and what the run works on once its configuration is resolved.
   */
  public record(step: Step, event: RunEntry["event"], message: string, facts: Pick<RunEntry, "durationMs" | "modelRequests" | "scope"> = {}): void {
    const entry: RunEntry = { at: this.now().toISOString(), step, event, message: this.mask(message), ...facts };
    this.written.push(entry);
    this.output.entry(entry);
  }
}
