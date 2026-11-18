import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { traceFile, TRACES_FOLDER, type AgentEvent, type HarnessEvent, type TraceLine, type TracePhase } from "@open-qa-stack/domain";
import { redactText, secretForms } from "@open-qa-stack/tools";

/** Longest string a trace keeps whole. */
export const MAX_TRACED_LENGTH = 10_000;

/** What a trace is written with. */
export interface TraceOptions {
  /** The secrets masked in every line. */
  readonly secrets: readonly string[];
  /** Receives each line as it is written. */
  readonly observe?: (line: TraceLine) => void;
  /** The clock of the dates. */
  readonly now: () => Date;
}

/**
 * The trace of a run, a cartography or a design: what the harness did and what the agent thought, called and received, phase
 * by phase, written line by line to a JSON Lines file.
 *
 * @remarks
 * Each line is appended as soon as it happens, so that a run stopped short leaves its trace up to the stop,
 * and handed to the observer, if any, at the same moment. Every secret is masked in every form a tool could
 * give it, and a string longer than `MAX_TRACED_LENGTH` is cut, with the number of characters left out.
 */
export class Trace {
  /** Where the trace is written. */
  public readonly path: string;
  private readonly forms: readonly string[];
  private readonly options: TraceOptions;

  /**
   * @param path - The file the lines are appended to; its folder is made when missing.
   * @param options - The secrets, the observer and the clock.
   */
  public constructor(path: string, options: TraceOptions) {
    this.path = path;
    this.options = options;
    this.forms = options.secrets.filter((secret) => secret !== "").flatMap(secretForms);
    mkdirSync(dirname(path), { recursive: true });
  }

  /**
   * The path of a new trace in the state folder of a test repository.
   *
   * @param stateFolder - Absolute path of the state folder.
   * @param name - What the trace is of, as `cartography-local`.
   * @param date - When the run started.
   * @returns The path, named by `name` and the date.
   */
  public static pathFor(stateFolder: string, name: string, date: Date): string {
    return join(stateFolder, TRACES_FOLDER, traceFile(name, date));
  }

  /**
   * Writes what the harness did.
   *
   * @param phase - The phase.
   * @param event - What happened.
   * @param source - The source concerned, when there is one.
   * @throws Error when the line cannot be written to the disk.
   */
  public harness(phase: TracePhase, event: HarnessEvent, source?: string): void {
    this.write({ at: this.options.now().toISOString(), phase, ...(source === undefined ? {} : { source }), actor: "harness", event });
  }

  /**
   * Writes what the agent did.
   *
   * @param phase - The phase.
   * @param event - What its session reported.
   * @param source - The source concerned, when there is one.
   * @throws Error when the line cannot be written to the disk.
   */
  public agent(phase: TracePhase, event: AgentEvent, source?: string): void {
    const traced = event.type === "error" ? { ...event, error: { name: event.error.name, message: event.error.message } } : event;
    this.write({ at: this.options.now().toISOString(), phase, ...(source === undefined ? {} : { source }), actor: "agent", event: traced });
  }

  private write(line: TraceLine): void {
    const kept = this.kept(line) as TraceLine;
    appendFileSync(this.path, `${JSON.stringify(kept)}\n`);
    this.options.observe?.(kept);
  }

  /** A value with its secrets masked and its long strings cut, keys included, however deep. */
  private kept(value: unknown): unknown {
    if (typeof value === "string") return cut(redactText(value, this.forms));
    if (Array.isArray(value)) return value.map((item) => this.kept(item));
    if (typeof value === "object" && value !== null)
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [cut(redactText(key, this.forms)), this.kept(item)]));
    return value;
  }
}

function cut(text: string): string {
  return text.length <= MAX_TRACED_LENGTH ? text : `${text.slice(0, MAX_TRACED_LENGTH)}[… ${text.length - MAX_TRACED_LENGTH} characters cut]`;
}
