import type { ManifestDomain } from "@open-qa-stack/domain";

/** Most elements of one source a domain holds; a domain that has them is full, and a narrower one is asked for. */
export const MAX_DOMAIN_ELEMENTS = 40;

/** Where the grouping of a source left one of its elements. */
export type ElementState =
  /** In a domain, with its role in one line. */
  | { readonly domain: string; readonly role: string }
  /** Set aside by the model, with its reason. */
  | { readonly dismissed: string }
  /** Left without a place by the harness, with the reason. */
  | { readonly unplaced: string };

/**
 * The grouping of the elements of one source into functional domains, as it stands batch after batch.
 */
export class Grouping {
  private readonly known = new Map<string, ManifestDomain>();
  private readonly states = new Map<string, ElementState>();

  /**
   * The domains known so far: those created, and those remembered from an earlier run.
   *
   * @returns Them, in the order they were known.
   */
  public domains(): ManifestDomain[] {
    return [...this.known.values()];
  }

  /**
   * The domains that hold an element.
   *
   * @returns Them, in the order they were known.
   */
  public populated(): ManifestDomain[] {
    return this.domains().filter((domain) => this.members(domain.id).length > 0);
  }

  /**
   * Makes a domain of an earlier run known, without any element yet.
   *
   * @param domain - The domain.
   */
  public remember(domain: ManifestDomain): void {
    this.known.set(domain.id, domain);
  }

  /**
   * @param id - Identifier of a domain.
   * @returns The domain, or `undefined` when none has this identifier.
   */
  public domain(id: string): ManifestDomain | undefined {
    return this.known.get(id);
  }

  /**
   * @param id - Identifier of a domain.
   * @returns The names of the elements placed in it, in the order they were placed.
   */
  public members(id: string): string[] {
    return [...this.states].flatMap(([name, state]) => ("domain" in state && state.domain === id ? [name] : []));
  }

  /**
   * @param id - Identifier of a domain.
   * @returns Whether the domain holds `MAX_DOMAIN_ELEMENTS` elements.
   */
  public isFull(id: string): boolean {
    return this.members(id).length >= MAX_DOMAIN_ELEMENTS;
  }

  /**
   * @param name - Name of an element.
   * @returns Where the grouping left it; `undefined` while no batch settled it.
   */
  public state(name: string): ElementState | undefined {
    return this.states.get(name);
  }

  /**
   * @param name - Name of an element.
   * @returns Whether it is in a domain or set aside by the model, so that no batch has to place it.
   */
  public isSettled(name: string): boolean {
    const state = this.states.get(name);
    return state !== undefined && !("unplaced" in state);
  }

  /**
   * Places an element in a domain, which is created when it is new.
   *
   * @param name - Name of the element.
   * @param domain - The domain.
   * @param role - What the element holds or does, in one line.
   */
  public place(name: string, domain: ManifestDomain, role: string): void {
    if (!this.known.has(domain.id)) this.known.set(domain.id, domain);
    this.states.set(name, { domain: domain.id, role });
  }

  /**
   * Sets an element aside, as the model asked.
   *
   * @param name - Name of the element.
   * @param reason - Why it belongs to no domain.
   */
  public dismiss(name: string, reason: string): void {
    this.states.set(name, { dismissed: reason });
  }

  /**
   * Leaves an element without a place, to be placed by a later run.
   *
   * @param name - Name of the element.
   * @param reason - Why the harness stopped asking.
   */
  public leave(name: string, reason: string): void {
    this.states.set(name, { unplaced: reason });
  }
}
