/**
 * The kinds of knowledge a memory may be, each the answer to a question an agent asks before it acts.
 *
 * @remarks
 * - `business_rule`: a rule the application applies — what a test checks.
 * - `pitfall`: what misleads an agent or breaks a test, such as a delay, a field that empties itself or a label
 *   that says something else — what to avoid.
 * - `test_data`: a record, an account by role or a value a test can rely on, never a password — what to test with.
 * - `locator`: how to target an element of a screen reliably — how to find it.
 * - `navigation`: how to reach a screen or a state — how to get there.
 * - `vocabulary`: two sources or two screens that name the same thing differently — what is spoken of.
 *
 * What a domain holds is no kind: that is the knowledge, which the memory does not copy.
 */
export const MEMORY_KINDS = ["business_rule", "pitfall", "test_data", "locator", "navigation", "vocabulary"] as const;

/** A kind of knowledge a memory is. */
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/** The domain of a memory that holds across the domains of the application. */
export const GENERAL_DOMAIN = "general";

/** Who wrote or corrected a memory, and when. */
export interface MemoryOrigin {
  /** The role of the agent: `cartographer`, `planner`… */
  readonly role: string;
  /** The task it did it in. */
  readonly task: string;
  /** Date and time, ISO 8601 in UTC. */
  readonly at: string;
}

/** What a memory says: what an agent writes, and what a correction replaces. */
export interface MemoryContent {
  /** What the agent learned, in a few sentences. */
  readonly text: string;
  /** Words that file it, in lower case; none at all is allowed. */
  readonly tags: readonly string[];
  /** The knowledge source or the application it is about, when there is one. */
  readonly source?: string;
}

/** A fact an agent kept for the agents that come after it, filed under a domain and a kind. */
export interface Memory extends MemoryContent {
  /** Its identifier, given when it is written and never changed. */
  readonly id: string;
  /** The identifier of the domain of the knowledge it is about, or `general`. */
  readonly domain: string;
  /** The kind of knowledge it is. */
  readonly kind: MemoryKind;
  /** Who wrote it, and when. */
  readonly written: MemoryOrigin;
  /** Who corrected it last, and when; none for a memory never corrected. */
  readonly revised?: MemoryOrigin;
  /** Set when a person set it aside: the agents recall it no more. */
  readonly disabled?: true;
}

/** Which memories to list: each filter given keeps those that equal it exactly. */
export interface MemoryFilter {
  readonly domain?: string;
  readonly kind?: MemoryKind;
  readonly source?: string;
}

/** A memory found by a search, and how well it matches. */
export interface FoundMemory extends Memory {
  /** Two points per tag in common, one per word of the query found in the text. */
  readonly score: number;
}

/** What to rank memories against. */
export interface MemoryQuery {
  /** Memories that bear one of these tags match. */
  readonly tags?: readonly string[];
  /** Memories whose text holds one of these words match. */
  readonly text?: string;
  /** Most memories to return. */
  readonly limit: number;
}
