import type { ToolDefinition } from "@open-qa-stack/domain";
import { SLUG_PATTERN, type DomainIndexSubmission, type IndexDomain, type SourceCard } from "@open-qa-stack/shared";
import { redactText, secretForms } from "@open-qa-stack/tools";
import type { Journal } from "../common/journal.ts";

/** Name of the tool the orchestrator hands the domains of the application in with. */
export const SUBMIT_TOOL = "submit_index";
/** Submissions in a row that leave domains of sources aside before the harness keeps each as a domain of its own. */
export const KEPT_BY_HARNESS_AFTER = 2;
/** Longest label or description of a domain, in characters. */
const MAX_LINE_LENGTH = 200;
const SLUG = new RegExp(SLUG_PATTERN);

/** A domain of a source that a domain of the application gathers, whole or for some of its elements. */
interface Gathered {
  readonly source: string;
  readonly domain: string;
  /** The elements taken, for a domain of a source cut between two domains of the application; all those no other takes when left out. */
  readonly items?: readonly string[];
}

/** A domain of the application, as the orchestrator hands it in: the domains of the sources it gathers. */
interface Consolidated {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly from: readonly Gathered[];
}

/**
 * The domains of an application, as the orchestrator of the cartography hands them in from those of its
 * sources.
 *
 * @remarks
 * Each source was mapped by its own agent, which grouped what it holds into domains. The orchestrator does
 * not place elements again: it says which domains of the sources are one functional area of the application,
 * and the elements follow their domain. A domain of a source that covers two areas is cut by naming the
 * elements each takes; a part that names none takes those no other does. What the agent of a source set
 * aside stays in `unassigned`: it is not asked again.
 *
 * The harness refuses, saying what to do: an identifier that is no slug or is given twice, a label or a
 * description that is empty or too long, a source without a card, a domain its card does not have, an
 * element its domain does not hold, an element taken twice, and a secret. Every domain of every source must
 * end in one domain of the application: a refusal names those left. After `KEPT_BY_HARNESS_AFTER`
 * submissions in a row that are right but for domains left aside, the harness keeps each of those as a
 * domain of the application of its own, under the identifier its source gave it, joined to the domain of
 * the application that bears that identifier when there is one, and the journal says so. Only the first
 * submission accepted is kept.
 */
export class DomainConsolidation {
  private readonly cards: ReadonlyMap<string, SourceCard>;
  private readonly forms: readonly string[];
  private readonly journal: Journal;
  private kept: DomainIndexSubmission | undefined;
  private refusal: string | undefined;
  private asideInARow = 0;

  /**
   * @param cards - The card of each source that has one.
   * @param secrets - The secrets of the configuration, which no index may hold.
   * @param journal - Where refusals and the acceptance are written.
   */
  public constructor(cards: ReadonlyMap<string, SourceCard>, secrets: readonly string[], journal: Journal) {
    this.cards = cards;
    this.forms = secrets.filter((secret) => secret !== "").flatMap(secretForms);
    this.journal = journal;
  }

  /**
   * The index accepted, if any.
   *
   * @returns Its domains, each with the elements of the sources it gathers, and what the sources set aside.
   */
  public get accepted(): DomainIndexSubmission | undefined {
    return this.kept;
  }

  /**
   * The tool the orchestrator hands the domains in with.
   *
   * @returns The tool.
   */
  public tool(): ToolDefinition {
    const text = { type: "string" };
    return {
      name: SUBMIT_TOOL,
      description:
        "Hands in the domains of the application: each with the domains of the sources it gathers. Every domain of every source must be in one domain of the application.",
      parameters: {
        type: "object",
        properties: {
          domains: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { ...text, description: "An English slug: lower case letters and digits, separated by hyphens." },
                label: text,
                description: { ...text, description: "One sentence." },
                from: {
                  type: "array",
                  description: "The domains of the sources that are this functional area.",
                  items: {
                    type: "object",
                    properties: {
                      source: { ...text, description: "Identifier of the source, as listed." },
                      domain: { ...text, description: "Identifier of a domain of that source, as listed." },
                      items: {
                        type: "array",
                        items: text,
                        description:
                          "Only to cut a domain of a source between two domains of the application: the elements this one takes, exactly as the source names them. Left out, the whole domain is taken.",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      execute: async (args) => this.submit(args),
    };
  }

  /**
   * The message that reminds an orchestrator which stopped without an accepted index to hand one in.
   *
   * @returns The reminder, with the latest refusal; `undefined` once an index was accepted.
   */
  public reminder(): string | undefined {
    if (this.kept !== undefined) return undefined;
    this.journal.record("info", "The agent stopped without an accepted index; it was reminded to hand one in.");
    return `You have not handed in an accepted index yet. Call ${SUBMIT_TOOL} now.${this.refusal === undefined ? "" : `\n\n${this.refusal}`}`;
  }

  private submit(args: unknown): string | { error: string } {
    if (this.kept !== undefined) return "The index was already accepted; there is nothing more to do.";
    const { domains, errors } = this.read(args);
    const left = errors.length === 0 ? this.aside(domains) : [];
    if (errors.length > 0 || (left.length > 0 && this.asideInARow + 1 < KEPT_BY_HARNESS_AFTER)) {
      this.asideInARow = errors.length === 0 ? this.asideInARow + 1 : 0;
      return this.refuse(errors, left);
    }
    if (left.length > 0)
      this.journal.record(
        "info",
        `${KEPT_BY_HARNESS_AFTER} submissions of the index in a row left domains of the sources aside; the harness kept each as a domain of the application: ${left.map(({ source, domain }) => `${source} › ${domain}`).join(", ")}.`,
      );
    this.kept = this.index([...domains, ...left.map((gathered) => this.own(gathered))]);
    this.journal.record("info", "The index was accepted.");
    return "The index was accepted. Answer with one sentence that sums it up; call no more tools.";
  }

  /** The domains a submission gives, as far as they can be read, and what is wrong with them. */
  private read(args: unknown): { readonly domains: Consolidated[]; readonly errors: string[] } {
    const errors: string[] = [];
    const given = (args as { domains?: unknown } | null)?.domains;
    if (!Array.isArray(given) || given.length === 0) return { domains: [], errors: ["Give in domains the domains of the application, one at least."] };
    const taken = new Set<string>();
    const domains = (given as readonly Partial<Record<keyof Consolidated, unknown>>[]).map((domain, at): Consolidated => {
      const where = `domains/${at}`;
      const id = String(domain.id);
      const line = (text: unknown) => (typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "");
      const [label, description] = [line(domain.label), line(domain.description)];
      if (!SLUG.test(id))
        errors.push(`${where}: the id ${JSON.stringify(id)} is not a slug. Write lower case letters and digits separated by hyphens, such as "order-returns".`);
      if ((given as readonly { id?: unknown }[]).findIndex((other) => String(other.id) === id) !== at)
        errors.push(`${where}: the id ${id} is given to several domains. Give them one domain, or two ids.`);
      for (const [name, text] of [
        ["label", label],
        ["description", description],
      ] as const)
        if (text === "" || text.length > MAX_LINE_LENGTH) errors.push(`${where}: give its ${name} on one line of ${MAX_LINE_LENGTH} characters at most.`);
      const from = Array.isArray(domain.from) ? (domain.from as readonly Partial<Record<keyof Gathered, unknown>>[]) : [];
      if (from.length === 0) errors.push(`${where}: give in from the domains of the sources that ${id} gathers.`);
      const gathered = from.flatMap((part): Gathered[] => {
        const [source, name] = [String(part.source), String(part.domain)];
        const card = this.cards.get(source);
        if (card === undefined) {
          errors.push(`${where}: ${source} is no source with a card. The sources: ${[...this.cards.keys()].join(", ")}.`);
          return [];
        }
        const held = card.domains.find((candidate) => candidate.id === name);
        if (held === undefined) {
          errors.push(`${where}: ${source} has no domain ${name}. Its domains: ${card.domains.map((candidate) => candidate.id).join(", ") || "none"}.`);
          return [];
        }
        const items = Array.isArray(part.items) ? part.items.map(String) : undefined;
        if (items?.length === 0) {
          errors.push(`${where}: items of ${source} › ${name} is empty. Leave items out to take the whole domain, or name the elements this domain takes.`);
          return [];
        }
        const unknown = (items ?? []).filter((item) => !held.items.some((element) => element.name === item));
        for (const item of unknown) errors.push(`${where}: ${item} is no element of the domain ${name} of ${source}. Write it exactly as the source names it.`);
        const key = (item: string) => `${source}\u0000${name}\u0000${item}`;
        for (const item of items ?? []) {
          if (taken.has(key(item))) errors.push(`${where}: ${item} of ${source} › ${name} is taken by two domains. An element is in one domain.`);
          taken.add(key(item));
        }
        return [{ source, domain: name, ...(items === undefined ? {} : { items: items.filter((item) => !unknown.includes(item)) }) }];
      });
      return { id, label, description, from: gathered };
    });
    // A domain of a source taken whole by two domains of the application is an element taken twice.
    const whole = domains.flatMap((domain) => domain.from.filter((part) => part.items === undefined).map((part) => `${part.source} › ${part.domain}`));
    for (const twice of new Set(whole.filter((name, at) => whole.indexOf(name) !== at)))
      errors.push(`${twice} is taken whole by two domains. Give it to one, or cut it by naming in items the elements each takes.`);
    const text = JSON.stringify(domains);
    if (redactText(text, this.forms) !== text) errors.push("The index holds a secret of the configuration; write it without the secret.");
    return { domains, errors };
  }

  /** The domains of the sources, or what is left of one cut, that no domain of the application takes. */
  private aside(domains: readonly Consolidated[]): Gathered[] {
    const parts = domains.flatMap((domain) => domain.from);
    return [...this.cards].flatMap(([source, card]) =>
      card.domains.flatMap((held): Gathered[] => {
        const taking = parts.filter((part) => part.source === source && part.domain === held.id);
        if (taking.some((part) => part.items === undefined)) return [];
        const named = new Set(taking.flatMap((part) => part.items!));
        const left = held.items.map((element) => element.name).filter((name) => !named.has(name));
        if (left.length === 0) return [];
        return [{ source, domain: held.id, ...(taking.length === 0 ? {} : { items: left }) }];
      }),
    );
  }

  /** A domain of a source left aside, as a domain of the application of its own: under the identifier, the label and the description its source gave it. */
  private own(gathered: Gathered): Consolidated {
    const { id, label, description } = this.cards.get(gathered.source)!.domains.find((held) => held.id === gathered.domain)!;
    return { id, label, description, from: [gathered] };
  }

  /** The index of the domains accepted: each with the elements of the sources it gathers, the domains of one identifier joined, and what the sources set aside. */
  private index(domains: readonly Consolidated[]): DomainIndexSubmission {
    const parts = domains.flatMap((domain) => domain.from);
    const elements = ({ source, domain, items }: Gathered): string[] => {
      const held = this.cards.get(source)!.domains.find((candidate) => candidate.id === domain)!;
      if (items !== undefined) return [...items];
      const named = new Set(parts.filter((part) => part.source === source && part.domain === domain).flatMap((part) => part.items ?? []));
      return held.items.map((element) => element.name).filter((name) => !named.has(name));
    };
    const joined = new Map<string, IndexDomain>();
    for (const { id, label, description, from } of domains) {
      const domain = joined.get(id) ?? { id, label, description, references: [] };
      for (const part of from) {
        // A domain of a source taken whole once its elements were all named elsewhere brings none: it adds no reference.
        const brought = elements(part);
        if (brought.length === 0) continue;
        const reference = domain.references.find((known) => known.source === part.source);
        if (reference === undefined) domain.references.push({ source: part.source, items: brought });
        else reference.items.push(...brought);
      }
      joined.set(id, domain);
    }
    const unassigned = [...this.cards].flatMap(([source, card]) => (card.unassigned.length === 0 ? [] : [{ source, items: [...card.unassigned] }]));
    return { domains: [...joined.values()].filter((domain) => domain.references.length > 0), unassigned };
  }

  /** Refuses a submission: what is wrong, then the domains of the sources still in no domain of the application. */
  private refuse(errors: readonly string[], left: readonly Gathered[]): { error: string } {
    const masked = (text: string) => redactText(text, this.forms);
    for (const error of errors) this.journal.record("error", masked(`The index was refused: ${error}`));
    const named = left.map(({ source, domain, items }) => `- ${source} › ${domain}${items === undefined ? "" : `: ${items.join(", ")}`}`);
    if (named.length > 0) this.journal.record("error", `The index was refused: ${left.length} domains of the sources are in no domain of the application.`);
    const placing =
      named.length === 0 ? [] : ["Still in no domain of the application; give each in from, to the domain it belongs to or to one of its own:", ...named];
    this.refusal = masked(["The index was refused. Fix it and submit it again.", ...errors.map((error) => `- ${error}`), ...placing].join("\n"));
    return { error: this.refusal };
  }
}
