import type { JsonSchema, ToolDefinition } from "@open-qa-stack/domain";
import type { IndexError, IndexValidation } from "@open-qa-stack/shared";
import type { Journal } from "./journal.ts";

/** Most errors told to the agent at once, besides the items still to place. */
const MAX_TOLD_ERRORS = 30;

/** What a submission is checked against once it matches its schema. */
export interface SubmissionCheck<T> {
  /** The submission as kept, normalised. */
  readonly value: T;
  /** What is wrong with it; none when it is accepted. */
  readonly errors: readonly IndexError[];
  /** By source, the items it still has to place. */
  readonly unplaced: ReadonlyMap<string, readonly string[]>;
}

/** How a kind of result is handed in: its tool, its schema and its rules. */
export interface SubmissionRules<T> {
  /** Name of the tool the agent hands the result in with. */
  readonly tool: string;
  /** What the result is, for messages: `index`, `card`… */
  readonly what: string;
  /** Description of the tool, written for the model. */
  readonly description: string;
  /** The shape of a submission given to the model; its rules are left to `validate` and `check`. */
  readonly shape: JsonSchema;
  /** Checks a submission against its schema. */
  validate(args: unknown): IndexValidation<T>;
  /** Normalises a valid submission, then checks it against what the harness read. */
  check(value: T): SubmissionCheck<T>;
}

/**
 * A result an agent hands in with a tool, checked by the harness before it is kept.
 *
 * @remarks
 * A refused submission is journaled and explained to the agent — the errors, then by source every item
 * still to place — so that it may submit again while its limits allow. Only the first accepted submission
 * is kept.
 */
export class HandedIn<T> {
  private readonly rules: SubmissionRules<T>;
  private readonly journal: Journal;
  private kept: T | undefined;
  private refusal: string | undefined;

  /**
   * @param rules - How the result is handed in and checked.
   * @param journal - Where refusals and the acceptance are written.
   */
  public constructor(rules: SubmissionRules<T>, journal: Journal) {
    this.rules = rules;
    this.journal = journal;
  }

  /**
   * The submission accepted, if any.
   *
   * @returns It, or `undefined` when none was.
   */
  public get accepted(): T | undefined {
    return this.kept;
  }

  /**
   * The tool the agent hands its result in with.
   *
   * @returns The tool.
   */
  public tool(): ToolDefinition {
    return { name: this.rules.tool, description: this.rules.description, parameters: this.rules.shape, execute: async (args) => this.submit(args) };
  }

  /**
   * The message that reminds an agent which stopped without an accepted result to hand one in.
   *
   * @returns The reminder, with the latest refusal; `undefined` once a result was accepted.
   */
  public reminder(): string | undefined {
    if (this.kept !== undefined) return undefined;
    const { what, tool } = this.rules;
    this.journal.record("info", `The agent stopped without an accepted ${what}; it was reminded to hand one in.`);
    return `You have not handed in an accepted ${what} yet. Call ${tool} now.${this.refusal === undefined ? "" : `\n\n${this.refusal}`}`;
  }

  private submit(args: unknown): string | { error: string } {
    const { what } = this.rules;
    if (this.kept !== undefined) return `The ${what} was already accepted; there is nothing more to do.`;
    const validation = this.rules.validate(args);
    if (!validation.ok) return this.refuse(validation.errors, new Map());
    const { value, errors, unplaced } = this.rules.check(validation.value);
    if (errors.length > 0) return this.refuse(errors, unplaced);
    this.kept = value;
    this.journal.record("info", `The ${what} was accepted.`);
    return `The ${what} was accepted. Answer with one sentence that sums it up; call no more tools.`;
  }

  private refuse(errors: readonly IndexError[], unplaced: ReadonlyMap<string, readonly string[]>): { error: string } {
    const { what } = this.rules;
    for (const error of errors) this.journal.record("error", `The ${what} was refused: ${error.message}`);
    const others = errors.filter((error) => error.path !== "");
    const told = others.slice(0, MAX_TOLD_ERRORS).map((error) => `- ${error.message}`);
    const more = others.length > MAX_TOLD_ERRORS ? [`- and ${others.length - MAX_TOLD_ERRORS} more`] : [];
    const missing = [...unplaced].map(([source, items]) => `- ${source}: ${JSON.stringify(items)}`);
    const placing = missing.length === 0 ? [] : ["Still to place, in a domain or in unassigned, each exactly as written:", ...missing];
    this.refusal = [`The ${what} was refused. Fix it and submit it again.`, ...told, ...more, ...placing].join("\n");
    return { error: this.refusal };
  }
}
