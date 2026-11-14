import type { JsonSchema, ToolDefinition } from "@open-qa-stack/domain";
import type { IndexError, IndexValidation } from "@open-qa-stack/shared";
import { redactText, secretForms } from "@open-qa-stack/tools";
import type { Journal } from "./journal.ts";

/** Most errors told to the agent at once, besides the items still to place. */
const MAX_TOLD_ERRORS = 30;

/** Refusals in a row that leave items to place before the harness puts them in `unassigned` itself. */
export const PLACED_BY_HARNESS_AFTER = 2;

/** What a submission is checked against once it matches its schema. */
export interface SubmissionCheck<T> {
  /** The submission as kept, normalised. */
  readonly value: T;
  /** What is wrong with it; none when it is accepted. */
  readonly errors: readonly IndexError[];
  /** By source, the items it still has to place. */
  readonly unplaced: ReadonlyMap<string, readonly string[]>;
  /** What the journal says of what the harness changed in it once accepted, when it changed something. */
  readonly note?: string;
}

/** A second submission asked once a first one was accepted, limited to what the first left aside. */
export interface FollowUp<T> {
  /** What the agent is asked, once told that its first submission was accepted. */
  readonly request: string;
  /** What the journal says of the second submission asked. */
  readonly asked: string;
  /** Normalises a valid second submission, merges it into the accepted one, then checks it. */
  check(value: T): SubmissionCheck<T>;
}

/** How a kind of result is handed in: its tool, its schema and its rules. */
export interface SubmissionRules<T> {
  /** Name of the tool the agent hands the result in with. */
  readonly tool: string;
  /** What the result is, for messages: `index`, `card`… */
  readonly what: string;
  /** The source the result is about, which names the journal entries; none for a result about several. */
  readonly source?: string;
  /** Secrets masked in every refusal journaled or told. */
  readonly secrets: readonly string[];
  /** Description of the tool, written for the model. */
  readonly description: string;
  /** The shape of a submission given to the model; its rules are left to `validate` and `check`. */
  readonly shape: JsonSchema;
  /** Checks a submission against its schema. */
  validate(args: unknown): IndexValidation<T>;
  /** Normalises a valid submission, then checks it against what the harness read. */
  check(value: T): SubmissionCheck<T>;
  /** The second submission to ask once one was accepted; none when there is nothing left to ask. */
  followUp?(accepted: T): FollowUp<T> | undefined;
  /** A valid submission with the given items added to its `unassigned`, as written. */
  leaveAside(value: T, unplaced: ReadonlyMap<string, readonly string[]>): T;
}

/**
 * A result an agent hands in with a tool, checked by the harness before it is kept.
 *
 * @remarks
 * A refused submission is journaled and explained to the agent — the errors, then by source every item
 * still to place — so that it may submit again while its limits allow, every secret of the configuration
 * masked. Only the first accepted submission is kept, unless its rules ask a second one: the agent is then
 * told what it is, and a second submission accepted replaces the first by their merge. The agent may answer
 * instead; the first stays as it is.
 *
 * A small model may keep forgetting the same items. Once {@link PLACED_BY_HARNESS_AFTER} submissions in a row
 * leave items to place, the harness puts those of the latest in
 * `unassigned` itself and checks it again: it is accepted, and journaled as such, only when nothing else is wrong.
 */
export class HandedIn<T> {
  private readonly rules: SubmissionRules<T>;
  private readonly journal: Journal;
  private kept: T | undefined;
  private pending: FollowUp<T> | undefined;
  private refusal: string | undefined;
  private unplacedInARow = 0;

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
   * Whether the submission accepted waits on the second one its rules asked.
   *
   * @returns `true` while that second submission is neither accepted nor given up.
   */
  public get followUpPending(): boolean {
    return this.pending !== undefined;
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
    this.record("info", `The agent stopped without an accepted ${what}; it was reminded to hand one in.`);
    return `You have not handed in an accepted ${what} yet. Call ${tool} now.${this.refusal === undefined ? "" : `\n\n${this.refusal}`}`;
  }

  private submit(args: unknown): string | { error: string } {
    const { what } = this.rules;
    if (this.kept !== undefined && this.pending === undefined) return `The ${what} was already accepted; there is nothing more to do.`;
    const validation = this.rules.validate(args);
    if (!validation.ok) return this.refuse(validation.errors, new Map());
    const second = this.pending !== undefined;
    const checking = this.pending ?? this.rules;
    let checked = checking.check(validation.value);
    if (checked.errors.length > 0) {
      const aside = this.leftAside(validation.value, checked.unplaced, checking);
      if (aside === undefined) return this.refuse(checked.errors, checked.unplaced);
      checked = aside;
    }
    const { value, note } = checked;
    this.unplacedInARow = 0;
    this.kept = value;
    this.pending = second ? undefined : this.rules.followUp?.(value);
    this.record("info", second ? `The second submission of the ${what} was accepted.` : `The ${what} was accepted.`);
    if (note !== undefined) this.record("info", note);
    if (this.pending === undefined) return `The ${what} was accepted. Answer with one sentence that sums it up; call no more tools.`;
    this.record("info", this.pending.asked);
    return `The ${what} was accepted. ${this.pending.request}`;
  }

  /** The check of the submission with its unplaced items in `unassigned`, once that is due and leaves nothing wrong. */
  private leftAside(valid: T, unplaced: ReadonlyMap<string, readonly string[]>, checking: Pick<SubmissionRules<T>, "check">): SubmissionCheck<T> | undefined {
    const { what } = this.rules;
    this.unplacedInARow = unplaced.size === 0 ? 0 : this.unplacedInARow + 1;
    if (this.unplacedInARow < PLACED_BY_HARNESS_AFTER) return undefined;
    const again = checking.check(this.rules.leaveAside(valid, unplaced));
    if (again.errors.length > 0) return undefined;
    const count = [...unplaced.values()].flat().length;
    this.record(
      "info",
      `${this.unplacedInARow} submissions of the ${what} in a row left items to place; the harness put the ${count} of the latest in unassigned.`,
    );
    return again;
  }

  private refuse(errors: readonly IndexError[], unplaced: ReadonlyMap<string, readonly string[]>): { error: string } {
    const { what } = this.rules;
    const forms = this.rules.secrets.filter((secret) => secret !== "").flatMap(secretForms);
    const masked = (text: string) => redactText(text, forms);
    const refused = this.pending === undefined ? `The ${what} was refused` : `The second submission of the ${what} was refused`;
    for (const error of errors) this.record("error", masked(`${refused}: ${error.message}`));
    const others = errors.filter((error) => error.path !== "");
    const told = others.slice(0, MAX_TOLD_ERRORS).map((error) => `- ${error.message}`);
    const more = others.length > MAX_TOLD_ERRORS ? [`- and ${others.length - MAX_TOLD_ERRORS} more`] : [];
    const missing = [...unplaced].map(([source, items]) => `- ${source}: ${JSON.stringify(items)}`);
    const placing = missing.length === 0 ? [] : ["Still to place, in a domain or in unassigned, each exactly as written:", ...missing];
    const header =
      this.pending === undefined
        ? `${refused}. Fix it and submit it again.`
        : `${refused}; the ${what} accepted before is kept. Fix it and submit again only what was asked.`;
    this.refusal = masked([header, ...told, ...more, ...placing].join("\n"));
    return { error: this.refusal };
  }

  private record(level: "info" | "error", message: string): void {
    this.journal.record(level, message, this.rules.source);
  }
}
