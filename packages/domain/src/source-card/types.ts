import type { KnowledgeBaseModel, KnowledgeBaseRun, KnowledgeBaseSourceType } from "../knowledge-base/types.ts";

/** Version of the source card format, independent of the product version. */
export type SourceCardFormatVersion = 1;

/** An element of a source, as the agent describes it: a table, a tag, a screen, a section, a folder. */
export interface CardItemSubmission {
  /** Its name, exactly as the source gives it. */
  name: string;
  /** One sentence on what it holds or does. */
  summary: string;
  /** Its important fields: columns of a table, parameters of an operation, fields of a screen. */
  keyFields?: string[];
}

/** An element of a card, with the facts the harness read about it without the model. */
export interface CardItem extends CardItemSubmission {
  /** Structural facts, by kind of source: keys of a table, operations of a tag… */
  facts?: Record<string, unknown>;
}

/** A functional domain of one source, as the agent hands it in. */
export interface CardDomainSubmission {
  /** A slug, in English. */
  id: string;
  label: string;
  /** One sentence. */
  description: string;
  items: CardItemSubmission[];
}

/** A functional domain of one source, in a card. */
export interface CardDomain extends Omit<CardDomainSubmission, "items"> {
  items: CardItem[];
}

/** What the cartographer of one source hands in: its domains, and the elements it put in none. */
export interface SourceCardSubmission {
  domains: CardDomainSubmission[];
  /** Names of the elements read but put in no domain. */
  unassigned: string[];
}

/** The card of one knowledge source: its elements grouped by functional domain. */
export interface SourceCard {
  formatVersion: SourceCardFormatVersion;
  source: { id: string; type: KnowledgeBaseSourceType };
  /** Fingerprint of the source when the card was made; a card whose fingerprint is the source's is up to date. */
  fingerprint: string;
  /** Date and time of production, ISO 8601 in UTC. */
  producedAt: string;
  model: KnowledgeBaseModel;
  run: KnowledgeBaseRun;
  /** `truncated` when a limit or the session cut the task. */
  status: "complete" | "truncated";
  domains: CardDomain[];
  unassigned: string[];
}
