import type { KnowledgeBaseSourceType } from "../knowledge-base/types.ts";

/**
 * Where the cartography of a source stands: `waiting`, it has no card yet; `mapping`, a session maps the knowledge
 * now; `mapped`, its card is written; `truncated`, its card is written, but a limit stopped it before its end.
 */
export type MappingState = "waiting" | "mapping" | "mapped" | "truncated";

/** A source the cartography reads — a knowledge source, the interface of an application — and where its cartography stands. */
export interface MappedSource {
  /** Its identifier: that of the knowledge source, or of the application for its interface. */
  readonly id: string;
  readonly type: KnowledgeBaseSourceType;
  readonly state: MappingState;
  /** When its card was written, as an ISO 8601 date; for a source mapped or truncated. */
  readonly mappedAt?: string;
}

/** Where the cartography of the knowledge stands, source by source, and the knowledge base that puts their cards together. */
export interface CartographyState {
  /** The environment the knowledge is mapped in: the first the configuration declares; left out without a configuration. */
  readonly environment?: string;
  /** Each source the cartography reads, in the order of the configuration, knowledge first. */
  readonly sources: readonly MappedSource[];
  /** The knowledge base the cartography wrote last, when there is one: when, and whether a limit stopped it before its end. */
  readonly knowledgeBase?: { readonly producedAt: string; readonly status: "complete" | "truncated" };
}
