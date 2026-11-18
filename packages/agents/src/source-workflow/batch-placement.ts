import {
  SLUG_PATTERN,
  validatePlacementSubmission,
  type ManifestDomain,
  type PlacementItem,
  type PlacementSubmission,
  type ToolDefinition,
} from "@open-qa-stack/domain";
import { redactText, secretForms, type ExportedElement } from "@open-qa-stack/tools";
import type { Journal } from "../common/journal.ts";
import { MAX_DOMAIN_ELEMENTS, type Grouping } from "./grouping.ts";
import { PLACE_TOOL } from "./grouping-prompt.ts";

/** Calls of the tool a batch gets: a first one, then two to fix what the harness named. */
export const MAX_PLACEMENT_CALLS = 3;

/** Longest role of an element, reason to set it aside, label or description of a domain, in characters. */
export const MAX_LINE_LENGTH = 200;

const SLUG = new RegExp(SLUG_PATTERN);

/** The shape of a placement, given to the model; its rules are left to the harness. */
const PLACEMENT_SHAPE = {
  type: "object",
  properties: {
    domains: {
      type: "array",
      description: "The new domains only.",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "An English slug: lower case letters and digits, separated by hyphens." },
          label: { type: "string" },
          description: { type: "string", description: "One sentence." },
        },
      },
    },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "The element, exactly as written." },
          domain: { type: "string", description: "Id of its domain." },
          role: { type: "string", description: "One line on what it holds or does." },
          reason: { type: "string", description: "Instead of domain and role: why it belongs to no domain." },
        },
      },
    },
  },
} as const;

/** What the placement of a batch needs. */
export interface BatchPlacementOptions {
  /** Identifier of the source. */
  readonly sourceId: string;
  /** What the batch is in the journal: `batch 2 of 5`. */
  readonly label: string;
  /** The elements of the batch. */
  readonly batch: readonly ExportedElement[];
  /** The grouping the placements go to. */
  readonly grouping: Grouping;
  /** The secrets of the configuration, which no role, reason, label nor description may hold. */
  readonly secrets: readonly string[];
  /** Where what the harness refused, proposed and closed is written. */
  readonly journal: Journal;
}

/**
 * The placement of one batch of elements, handed in with `place_elements` and checked element by element.
 *
 * @remarks
 * Every element the call places validly is kept at once; the answer names only what is wrong and what is
 * still to place. The harness answers in three ways. It proposes when it knows what to write instead — a
 * domain id that is no slug, a label given for an id — and never applies its proposal itself. It warns,
 * once per batch, when elements are set aside: the same call again confirms them. It refuses anything
 * else, saying what to do, with an example. A name written after the source and a slash or a colon is read
 * without them, and a role on several lines is put on one: neither changes what the model meant.
 *
 * A batch gets `MAX_PLACEMENT_CALLS` calls. After the last, or when the session ends, the elements still
 * to place are left unplaced with what was last said of each, and journaled: a later run places them.
 */
export class BatchPlacement {
  private readonly options: BatchPlacementOptions;
  private readonly forms: readonly string[];
  private readonly said = new Map<string, string>();
  private calls = 0;
  private warned = false;
  private over = false;

  /** @param options - What the placement needs. */
  public constructor(options: BatchPlacementOptions) {
    this.options = options;
    this.forms = options.secrets.flatMap(secretForms);
  }

  /**
   * Whether the batch takes no more placement.
   *
   * @returns `true` once every element is settled or the harness closed the batch.
   */
  public get closed(): boolean {
    return this.over || this.remaining().length === 0;
  }

  /**
   * The tool the model places the elements of the batch with.
   *
   * @returns The tool.
   */
  public tool(): ToolDefinition {
    return {
      name: PLACE_TOOL,
      description:
        "Places the elements of the batch: each in a domain with its role, or set aside with a reason. Declare in domains only the domains that do not exist yet.",
      parameters: PLACEMENT_SHAPE,
      execute: async (args) => this.submit(args),
    };
  }

  /**
   * The message that reminds a model which stopped before the batch was over to place what is left.
   *
   * @returns The reminder; `undefined` once the batch is closed.
   */
  public reminder(): string | undefined {
    if (this.closed) return undefined;
    const remaining = this.remaining();
    this.record("info", `The model stopped with ${remaining.length} elements of ${this.options.label} to place; it was reminded to place them.`);
    return `${remaining.length} elements of this batch are not placed yet: ${JSON.stringify(remaining)}. Call ${PLACE_TOOL} with them now.`;
  }

  /**
   * Closes the batch: the elements still to place are left unplaced, with what was last said of each.
   *
   * @param reason - Why the batch is closed, kept for an element nothing was said of.
   */
  public close(reason: string): void {
    const remaining = this.remaining();
    this.over = true;
    if (remaining.length === 0) return;
    for (const name of remaining) this.options.grouping.leave(name, this.said.get(name) ?? reason);
    this.record("error", `${this.options.label} was closed with ${remaining.length} elements unplaced: ${remaining.join(", ")}. ${reason}`);
  }

  /** The names of the elements of the batch no call settled yet. */
  private remaining(): string[] {
    const { batch, grouping } = this.options;
    return batch.map((element) => element.name).filter((name) => grouping.state(name) === undefined);
  }

  private submit(args: unknown): string | { error: string } {
    if (this.closed) return "This batch is over. Call no more tools.";
    this.calls++;
    const validation = validatePlacementSubmission(args);
    const problems = validation.ok ? this.place(validation.value) : validation.errors.map((error) => error.message);
    const remaining = this.remaining();
    if (remaining.length === 0) {
      this.record("info", `Every element of ${this.options.label} is placed.`);
      return `The ${this.options.batch.length} elements of this batch are settled. Answer with one word; call no more tools.`;
    }
    const told = problems.map((problem) => redactText(problem, this.forms));
    for (const problem of told) this.record("error", `The placement of ${this.options.label} was not kept as it is: ${problem}`);
    if (this.calls >= MAX_PLACEMENT_CALLS) {
      this.close(`The model had ${MAX_PLACEMENT_CALLS} calls.`);
      return { error: `This batch is closed: ${remaining.length} elements stay unplaced and will be asked again later. Call no more tools.` };
    }
    const example = { items: [{ name: remaining[0], domain: this.options.grouping.domains()[0]?.id ?? "orders", role: "One line on what it holds." }] };
    return {
      error: [
        `${this.options.batch.length - remaining.length} of ${this.options.batch.length} elements are settled. Fix what follows and call ${PLACE_TOOL} again with the elements still to place only.`,
        ...told.map((problem) => `- ${problem}`),
        `Still to place: ${JSON.stringify(remaining)}`,
        `Example: ${JSON.stringify(example)}`,
      ].join("\n"),
    };
  }

  /** Keeps what a valid call places validly. Returns what the harness proposes, warns of and refuses. */
  private place(submission: PlacementSubmission): string[] {
    const { grouping } = this.options;
    const problems: string[] = [];
    const declared = new Map<string, ManifestDomain | undefined>();
    for (const domain of submission.domains ?? []) {
      if (grouping.domain(domain.id) !== undefined) continue;
      const problem = this.domainProblem(domain);
      declared.set(domain.id, problem === undefined ? { id: domain.id, label: oneLine(domain.label), description: oneLine(domain.description) } : undefined);
      if (problem !== undefined) problems.push(problem);
    }
    const seen = new Set<string>();
    const aside: { name: string; reason: string }[] = [];
    for (const item of submission.items) {
      const name = this.elementName(item.name);
      if (name === undefined) {
        problems.push(`${item.name} is not an element of this batch. Use the names of the ### lines only.`);
        continue;
      }
      if (seen.has(name)) {
        problems.push(`${name} is given twice; the first was read. Give each element once.`);
        continue;
      }
      seen.add(name);
      if (grouping.state(name) !== undefined) continue;
      const problem = this.itemProblem(name, item, declared);
      if (problem !== undefined) {
        problems.push(problem);
        this.said.set(name, problem);
      } else if (item.domain === undefined) aside.push({ name, reason: oneLine(item.reason!) });
      else grouping.place(name, grouping.domain(item.domain) ?? declared.get(item.domain)!, oneLine(item.role!));
    }
    if (aside.length > 0 && !this.warned) {
      this.warned = true;
      const names = aside.map(({ name }) => name);
      for (const name of names) this.said.set(name, "The model set it aside and did not confirm.");
      problems.push(
        `You set aside ${names.join(", ")}. An element set aside is in no domain, and no agent will find it by domain. If that is what you mean, give them again the same way; otherwise place them.`,
      );
    } else for (const { name, reason } of aside) grouping.dismiss(name, reason);
    return problems;
  }

  /** The name of an element of the batch, read without the source written in front of it. */
  private elementName(written: string): string | undefined {
    const { batch, sourceId } = this.options;
    const names = new Set(batch.map((element) => element.name));
    const bare =
      !names.has(written) && (written.startsWith(`${sourceId}/`) || written.startsWith(`${sourceId}:`)) ? written.slice(sourceId.length + 1) : written;
    return names.has(bare) ? bare : undefined;
  }

  /** What is wrong with a new domain, or what the harness proposes instead; nothing when it can be created. */
  private domainProblem(domain: ManifestDomain): string | undefined {
    const { grouping } = this.options;
    if (!SLUG.test(domain.id)) {
      const slug = slugOf(domain.id);
      return slug === ""
        ? `The domain id ${JSON.stringify(domain.id)} is not a slug. Write lower case letters and digits separated by hyphens, such as "order-returns".`
        : `The domain id ${JSON.stringify(domain.id)} is not a slug. Proposed: "${slug}". If it suits you, declare the domain and place its elements again with that id.`;
    }
    const twin = grouping.domains().find((known) => known.label.toLowerCase() === oneLine(domain.label).toLowerCase());
    if (twin !== undefined)
      return `The domain ${domain.id} has the label of the domain ${twin.id}. Proposed: place its elements in ${twin.id}. If it is another area, give it another label.`;
    return (
      this.lineProblem(`The label of the domain ${domain.id}`, domain.label) ??
      this.lineProblem(`The description of the domain ${domain.id}`, domain.description)
    );
  }

  /** What is wrong with the placement of one element of the batch, or what the harness proposes; nothing when it is kept. */
  private itemProblem(name: string, item: PlacementItem, declared: ReadonlyMap<string, ManifestDomain | undefined>): string | undefined {
    const { grouping } = this.options;
    const placed = item.domain !== undefined && item.role !== undefined && item.reason === undefined;
    const aside = item.domain === undefined && item.role === undefined && item.reason !== undefined;
    if (!placed && !aside) return `${name} needs either a domain and a role, or a reason alone.`;
    if (aside) return this.lineProblem(`The reason of ${name}`, item.reason!);
    const id = item.domain!;
    if (declared.has(id) && declared.get(id) === undefined) return `${name}: its domain ${JSON.stringify(id)} was not created, for the reason given above.`;
    if (grouping.domain(id) === undefined && !declared.has(id)) {
      const meant = grouping.domains().find((domain) => domain.id === slugOf(id) || domain.label.toLowerCase() === id.toLowerCase());
      const ids = grouping.domains().map((domain) => domain.id);
      return meant === undefined
        ? `${name}: the domain ${JSON.stringify(id)} does not exist. Declare it in domains with an id, a label and a description${ids.length === 0 ? "" : `, or use one of ${ids.join(", ")}`}.`
        : `${name}: ${JSON.stringify(id)} is not a domain id. Proposed: "${meant.id}". If it suits you, place ${name} again with that id.`;
    }
    if (grouping.isFull(id))
      return `${name}: the domain ${id} is full, with ${MAX_DOMAIN_ELEMENTS} elements. Place it in another domain, or declare a narrower one, such as "${id}-history".`;
    return this.lineProblem(`The role of ${name}`, item.role!);
  }

  /** What is wrong with a text of one line: too long, or holding a secret, which is never repeated. */
  private lineProblem(what: string, text: string): string | undefined {
    const line = oneLine(text);
    if (line === "") return `${what} is empty. Write one line.`;
    if (redactText(line, this.forms) !== line) return `${what} holds a secret of the configuration. Write it without the secret.`;
    if (line.length > MAX_LINE_LENGTH)
      return `${what} has ${line.length} characters. Keep it under ${MAX_LINE_LENGTH}, such as "Orders placed by customers, one row each."`;
    return undefined;
  }

  private record(level: "info" | "error", message: string): void {
    this.options.journal.record(level, message, this.options.sourceId);
  }
}

/** A text on one line, its runs of white space turned into one space. */
function oneLine(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** The slug nearest to a text: its letters and digits in lower case, hyphens in between; empty when it has none. */
function slugOf(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
