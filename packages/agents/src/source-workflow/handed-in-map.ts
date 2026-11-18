import { SLUG_PATTERN, type ManifestDomain, type ToolDefinition } from "@open-qa-stack/domain";
import { redactText, secretForms, sourceExport, type ElementDraft, type SourceExport } from "@open-qa-stack/tools";
import type { Journal } from "../common/journal.ts";
import { minimalBody, unfenced, type DomainMember } from "./domain-file.ts";
import { domainFileErrors } from "./domain-file-control.ts";
import type { DomainFile } from "./export-manifest.ts";
import { Grouping, MAX_DOMAIN_ELEMENTS } from "./grouping.ts";

/** Name of the tool an agent hands one domain of its map in with. */
export const WRITE_DOMAIN_TOOL = "write_domain";
/** Name of the tool an agent sets parts of a source aside with. */
export const SET_ASIDE_TOOL = "set_aside";
/** Calls the harness refuses before it closes a map: what is placed stays, the rest is left unplaced. */
export const MAX_REFUSED_CALLS = 10;
/** Times the file of one domain is refused before the harness writes it itself. */
export const MAX_REFUSED_BODIES = 3;
/** Longest label, description, role or reason, in characters. */
export const MAX_LINE_LENGTH = 200;
/** Most parts a result names among those still to place. */
const MAX_NAMED = 20;
const SLUG = new RegExp(SLUG_PATTERN);

/** A part of a source an agent may place in a domain or set aside: what names it, and what it is in one word. */
export interface MapPart {
  readonly name: string;
  readonly kind: string;
}

/** A part placed in a domain, with what it holds or does in one line. */
export type PlacedPart<P extends MapPart> = P & Pick<DomainMember, "role">;

/** A domain an agent handed in and the harness kept. */
export interface KeptDomain<P extends MapPart> {
  readonly domain: ManifestDomain;
  readonly elements: readonly PlacedPart<P>[];
  readonly body: string;
  readonly writtenBy: DomainFile["writtenBy"];
  /** Why the harness wrote the body itself, and the body it refused, when it did. */
  readonly refused?: string;
  readonly refusedBody?: string;
}

/** How a map speaks of the parts of its source, and what an agent gives of one. */
export interface MapWords {
  /** The parts, in the plural: `documents or sections`. */
  readonly things: string;
  /** One part, with its article: `a document or a section`. */
  readonly one: string;
  /** What an agent gives of one part, as the properties of an object and those it must give. */
  readonly given: { readonly properties: Readonly<Record<string, unknown>>; readonly required: readonly string[] };
  /** What `write_domain` and `set_aside` are for, as their descriptions. */
  readonly write: string;
  readonly aside: string;
  /** What to give when a domain is handed in without any element, and when nothing is given to set aside. */
  readonly noElement: string;
  readonly noAside: string;
  /** What ends the line that names what is left, such as a rule of coverage; empty when there is none. */
  readonly hint: string;
}

/** What every map needs. */
export interface HandedInMapOptions {
  /** Identifier of the source. */
  readonly sourceId: string;
  /** The secrets of the configuration, which no file of a domain may hold. */
  readonly secrets: readonly string[];
  /** Where what the harness refused, warned of and kept is written. */
  readonly journal: Journal;
}

/** What a map gives once its session is over. */
export interface MapResult {
  /** The elements the agent chose, then what was set aside and what was left, as an export. */
  readonly exported: SourceExport;
  /** Where each element stands. */
  readonly grouping: Grouping;
  /** The file of each domain: its body, who wrote it, and what was refused when the harness did. */
  readonly files: ReadonlyMap<string, Pick<KeptDomain<MapPart>, "body" | "writtenBy" | "refused" | "refusedBody">>;
}

/**
 * The map of a source, as the agent that explores it hands it in, domain by domain.
 *
 * @remarks
 * The agent chooses its elements itself and hands each domain in with `write_domain`: its identifier, its
 * elements with the role of each, and the body of its file. What serves no functional area is set aside
 * with `set_aside`. The harness cuts nothing: a map of a kind of source says what its parts are, what the
 * agent must have looked at to place or set aside one, and what is still to cover; this class holds the
 * rest, the same for every kind.
 *
 * It refuses, saying what to do: an identifier that is no slug, a label, a description, a role or a reason
 * that is empty or too long, a part the source does not have, one given twice, already in another domain,
 * or both placed and set aside, one the agent did not look at enough, and a body that does not name every
 * element between backticks, is too long or holds a secret. A domain is kept whole or not at all, and
 * handing in a domain kept again replaces it. A map may warn once before it keeps a domain: the same call
 * again confirms.
 *
 * Every refusal has an exit. The third body refused for one domain is replaced by a table the harness
 * writes, and the domain is kept. After `MAX_REFUSED_CALLS` refusals the map is closed: what is placed
 * stays. What is in no domain and not set aside when the session ends is left unplaced, never lost: it is an
 * element of the export, with why.
 */
export abstract class HandedInMap<P extends MapPart> {
  protected readonly sourceId: string;
  private readonly secrets: readonly string[];
  private readonly journal: Journal;
  private readonly forms: readonly string[];
  private readonly words: MapWords;
  private readonly kept = new Map<string, KeptDomain<P>>();
  /** The parts set aside, by their name, each with why. */
  private readonly aside = new Map<string, P & { readonly reason: string }>();
  private readonly refusedBodies = new Map<string, number>();
  private readonly warned = new Set<string>();
  private refused = 0;

  /**
   * @param options - What every map needs.
   * @param words - How this map speaks of the parts of its source.
   */
  protected constructor(options: HandedInMapOptions, words: MapWords) {
    this.sourceId = options.sourceId;
    this.secrets = options.secrets;
    this.journal = options.journal;
    this.forms = options.secrets.flatMap(secretForms);
    this.words = words;
  }

  /**
   * Whether the map takes no more call.
   *
   * @returns `true` once the whole source is placed or set aside, or the harness closed the map.
   */
  public get closed(): boolean {
    return this.refused >= MAX_REFUSED_CALLS || this.remaining(this.settled()).length === 0;
  }

  /**
   * The tools the agent hands its map in with.
   *
   * @returns `write_domain` and `set_aside`.
   */
  public tools(): ToolDefinition[] {
    const line = { type: "string", minLength: 1 };
    const { properties, required } = this.words.given;
    return [
      {
        name: WRITE_DOMAIN_TOOL,
        description: this.words.write,
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "An English slug: lower case letters and digits, separated by hyphens." },
            label: line,
            description: { ...line, description: "One sentence." },
            elements: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: { ...properties, role: { ...line, description: "One line on what it states or does." } },
                required: [...required, "role"],
              },
            },
            ...this.more(),
            body: { type: "string", description: "The markdown body of the file of the domain, without its title." },
          },
          required: ["id", "label", "description", "elements", "body"],
        },
        execute: async (args) => this.write(args as Record<string, unknown>),
      },
      {
        name: SET_ASIDE_TOOL,
        description: this.words.aside,
        parameters: {
          type: "object",
          properties: {
            elements: { type: "array", minItems: 1, items: { type: "object", properties, required } },
            reason: { ...line, description: "Why, in one sentence." },
          },
          required: ["elements", "reason"],
        },
        execute: async (args) => this.setAside(args as Record<string, unknown>),
      },
    ];
  }

  /**
   * The message that reminds an agent which stopped while parts of the source are in no domain and not set aside.
   *
   * @returns The reminder; `undefined` once the map is closed.
   */
  public reminder(): string | undefined {
    if (this.closed) return undefined;
    this.record("info", `The agent stopped with ${this.remaining(this.settled()).length} ${this.words.things} in no domain; it was reminded to place them.`);
    return `You stopped before the end. ${this.left()}`;
  }

  /**
   * What the map holds, once its session is over.
   *
   * @returns Its elements as an export, where each stands, and the file of each domain.
   */
  public async result(): Promise<MapResult> {
    const grouping = new Grouping();
    const drafts: ElementDraft[] = [];
    for (const { domain, elements } of this.kept.values()) {
      for (const element of elements) {
        drafts.push(this.draft(element, await this.text(element)));
        grouping.place(element.name, domain, element.role);
      }
    }
    // What is in no domain is an element all the same, by its text: set aside with its reason, or left with why.
    for (const part of this.aside.values()) {
      drafts.push(this.draft(part, await this.text(part)));
      grouping.dismiss(part.name, part.reason);
    }
    const remaining = this.remaining(this.settled());
    for (const part of remaining) {
      drafts.push(this.draft(part, await this.text(part)));
      grouping.leave(part.name, "The session of the agent ended before it was placed or set aside.");
    }
    if (remaining.length > 0)
      this.record("error", `${remaining.length} ${this.words.things} were left in no domain: ${remaining.map((part) => part.name).join(", ")}.`);
    return { exported: sourceExport(drafts), grouping, files: this.kept };
  }

  /** A part of the source, as it holds it and the harness names it, or what is wrong with what the agent gave. */
  protected abstract part(given: Readonly<Record<string, unknown>>): P | string;

  /** Why a part may not be placed yet, such as one the agent did not look at; nothing when it may. */
  protected abstract placeProblem(part: P): string | undefined;

  /** Why a part may not be set aside yet, such as one the agent never saw; nothing when it may. */
  protected abstract asideProblem(part: P): string | undefined;

  /** What is in no domain and not set aside, given the parts that are one or the other. */
  protected abstract remaining(settled: readonly P[]): P[];

  /** The text of a part, which its file of the export holds. */
  protected abstract text(part: P): Promise<string>;

  /** A part as an element of the export. */
  protected abstract draft(part: P, text: string): ElementDraft;

  /** Whether a part to set aside is one a domain holds already, such as a whole of which an element is a part. */
  protected abstract held(part: P, element: P): boolean;

  /** How a part is named among those left, with what the agent needs to place it. */
  protected abstract called(part: P): string;

  /** What `write_domain` takes besides the elements and the body, as properties of its arguments. */
  protected abstract more(): Readonly<Record<string, unknown>>;

  /** What is wrong with what a call gives besides its elements and its body, and what the harness adds to the body. */
  protected abstract extra(args: Readonly<Record<string, unknown>>): { readonly problems: readonly string[]; readonly added: string };

  /** What the agent is asked once before a domain is kept, the same call again confirming; nothing when there is nothing to ask. */
  protected abstract question(id: string, elements: readonly PlacedPart<P>[]): string | undefined;

  /** Writes to the journal, under the source. */
  protected record(level: "info" | "error", message: string): void {
    this.journal.record(level, message, this.sourceId);
  }

  private async write(args: Record<string, unknown>): Promise<string | { error: string }> {
    if (this.closed) return this.over();
    const id = String(args["id"]);
    const domain = { id, label: oneLine(args["label"]), description: oneLine(args["description"]) };
    const problems = [...this.domainProblems(domain)];
    const elements: PlacedPart<P>[] = [];
    const given = Array.isArray(args["elements"]) ? (args["elements"] as readonly Readonly<Record<string, unknown>>[]) : [];
    if (given.length === 0) problems.push(this.words.noElement);
    if (given.length > MAX_DOMAIN_ELEMENTS)
      problems.push(`The domain has ${given.length} elements, ${MAX_DOMAIN_ELEMENTS} at most. Split it into two domains.`);
    for (const element of given.slice(0, MAX_DOMAIN_ELEMENTS)) {
      const found = this.element(element, id, elements);
      if (typeof found === "string") problems.push(found);
      else elements.push(found);
    }
    const extra = problems.length === 0 ? this.extra(args) : { problems: [], added: "" };
    problems.push(...extra.problems);
    if (problems.length > 0) return this.refuse(`The domain ${id} was not kept`, problems);
    const body = unfenced(typeof args["body"] === "string" ? args["body"] : "");
    const flaws = domainFileErrors(body, elements, this.secrets);
    const refusals = flaws.length === 0 ? 0 : (this.refusedBodies.get(id) ?? 0) + 1;
    if (flaws.length > 0 && refusals < MAX_REFUSED_BODIES) {
      this.refusedBodies.set(id, refusals);
      return this.refuse(`The file of the domain ${id} was not kept`, flaws);
    }
    const asked = this.warned.has(id) ? undefined : this.question(id, elements);
    if (asked !== undefined) {
      this.warned.add(id);
      return asked;
    }
    const byHarness = flaws.length > 0;
    this.kept.set(id, {
      domain,
      elements,
      body: `${byHarness ? minimalBody(elements) : body}${extra.added}`,
      writtenBy: byHarness ? "harness" : "model",
      ...(byHarness ? { refused: flaws.join(" "), refusedBody: body } : {}),
    });
    this.record(
      byHarness ? "error" : "info",
      byHarness
        ? `The harness wrote the file of the domain ${id} itself, after ${MAX_REFUSED_BODIES} bodies refused: ${this.masked(flaws.join(" "))}`
        : `The domain ${id} was kept with ${elements.length} elements.`,
    );
    return `The domain ${id} is kept with ${elements.length} elements${byHarness ? ", its file written by the harness" : ""}. ${this.left()}`;
  }

  private setAside(args: Record<string, unknown>): string | { error: string } {
    if (this.closed) return this.over();
    const reason = oneLine(args["reason"]);
    const given = Array.isArray(args["elements"]) ? (args["elements"] as readonly Readonly<Record<string, unknown>>[]) : [];
    const parts: P[] = [];
    const problems = given.flatMap((element) => {
      const part = this.part(element);
      if (typeof part === "string") return [part];
      const unseen = this.asideProblem(part);
      if (unseen !== undefined) return [unseen];
      const domain = [...this.kept.values()].find((kept) => kept.elements.some((placed) => this.held(part, placed)))?.domain.id;
      if (domain !== undefined) return [`${part.name} is in the domain ${domain}: ${this.words.one} is placed or set aside, not both.`];
      parts.push(part);
      return [];
    });
    if (given.length === 0) problems.push(this.words.noAside);
    if (reason === "" || reason.length > MAX_LINE_LENGTH) problems.push(`Give the reason in one sentence of ${MAX_LINE_LENGTH} characters at most.`);
    if (problems.length > 0) return this.refuse("Nothing was set aside", problems);
    for (const part of parts) this.aside.set(part.name, { ...part, reason });
    const names = parts.map((part) => part.name).join(", ");
    this.record("info", `${parts.length} ${this.words.things} were set aside: ${names}. ${this.masked(reason)}`);
    return `${parts.length} ${this.words.things} are set aside. ${this.left()}`;
  }

  /** What is wrong with a domain as it is declared; nothing when it can be kept. */
  private domainProblems({ id, label, description }: ManifestDomain): string[] {
    return [
      ...(SLUG.test(id)
        ? []
        : [`The domain id ${JSON.stringify(id)} is not a slug. Write lower case letters and digits separated by hyphens, such as "order-returns".`]),
      ...[label, description].flatMap((text, at) =>
        text === "" || text.length > MAX_LINE_LENGTH
          ? [`Give the ${at === 0 ? "label" : "description"} of the domain on one line of ${MAX_LINE_LENGTH} characters at most.`]
          : [],
      ),
    ];
  }

  /** An element as the source holds it, or what is wrong with it. */
  private element(given: Readonly<Record<string, unknown>>, domain: string, before: readonly PlacedPart<P>[]): PlacedPart<P> | string {
    const part = this.part(given);
    if (typeof part === "string") return part;
    const { name } = part;
    const role = oneLine(given["role"]);
    if (role === "" || role.length > MAX_LINE_LENGTH) return `Give the role of ${name} on one line of ${MAX_LINE_LENGTH} characters at most.`;
    if (this.aside.has(name)) return `${name} is set aside: ${this.words.one} is placed or set aside, not both.`;
    const unseen = this.placeProblem(part);
    if (unseen !== undefined) return unseen;
    if (before.some((other) => other.name === name)) return `${name} is given twice. Give each element once.`;
    const elsewhere = [...this.kept.values()].find((kept) => kept.domain.id !== domain && kept.elements.some((other) => other.name === name));
    if (elsewhere !== undefined) return `${name} is already in the domain ${elsewhere.domain.id}. Place an element in one domain.`;
    return { ...part, role };
  }

  /** The parts that are in a domain or set aside. */
  private settled(): P[] {
    return [...[...this.kept.values()].flatMap((kept) => kept.elements), ...this.aside.values()];
  }

  /** What is left to do, as every result ends. */
  private left(): string {
    const remaining = this.remaining(this.settled());
    if (remaining.length === 0) return "The whole source is placed or set aside. Answer with one sentence; call no more tools.";
    const more = remaining.length > MAX_NAMED ? `, and ${remaining.length - MAX_NAMED} more` : "";
    const named = remaining.slice(0, MAX_NAMED).map((part) => this.called(part));
    return `${remaining.length} ${this.words.things} are in no domain and not set aside: ${named.join(", ")}${more}. Next: place each with ${WRITE_DOMAIN_TOOL}, or set it aside with ${SET_ASIDE_TOOL}${this.words.hint}.`;
  }

  /** Refuses a call, and counts it: the last one closes the map. */
  private refuse(what: string, problems: readonly string[]): { error: string } {
    const told = problems.map((problem) => this.masked(problem));
    for (const problem of told) this.record("error", `${what}: ${problem}`);
    this.refused += 1;
    if (this.refused >= MAX_REFUSED_CALLS) {
      this.record("error", `The map of ${this.sourceId} was closed after ${MAX_REFUSED_CALLS} calls refused.`);
      return this.over();
    }
    return { error: [`Refused. ${what}. Fix what follows, and only that, then call the tool again.`, ...told.map((problem) => `- ${problem}`)].join("\n") };
  }

  private over(): { error: string } {
    return { error: "The map is closed: what is placed stays, and the rest will be asked again later. Answer with one sentence; call no more tools." };
  }

  private masked(text: string): string {
    return redactText(text, this.forms);
  }
}

/** A text given by the agent, on one line; empty when it is none. */
function oneLine(text: unknown): string {
  return typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
}
