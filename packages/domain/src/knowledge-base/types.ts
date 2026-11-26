/** Version of the knowledge base format, independent of the product version. */
export type KnowledgeBaseFormatVersion = 1;

/** Kind of a source the knowledge base lists: a knowledge source of the configuration, or the user interface of an application. */
export type KnowledgeBaseSourceType = "openapi" | "postgresql" | "document" | "source-code" | "web";

/** Whether the exploration covered a source. */
export type KnowledgeBaseSourceState = "read" | "not_read";

/** A source of the knowledge base: a knowledge source by its identifier, or an application's user interface by the application's identifier. */
export interface KnowledgeBaseSource {
  id: string;
  type: KnowledgeBaseSourceType;
  state: KnowledgeBaseSourceState;
  /** Fingerprint of the card the source was read from; a source not read has none. */
  cardFingerprint?: string;
}

/** Coarse references into one source: tags or path prefixes of a contract, tables of a base, URL paths of an interface, sections of a document, folders or files of source code. */
export interface SourceReferences {
  source: string;
  items: string[];
}

/** A functional domain of the application, and where to look for it. */
export interface KnowledgeBaseDomain {
  /** A slug, in English. */
  id: string;
  label: string;
  /** One sentence. */
  description: string;
  references: SourceReferences[];
}

/** What the agent hands in: the domains, and what it read but put in none. */
export interface KnowledgeBaseSubmission {
  domains: KnowledgeBaseDomain[];
  unassigned: SourceReferences[];
}

/** The model the knowledge base was produced with, without any secret. */
export interface KnowledgeBaseModel {
  provider: string;
  baseUrl: string;
  model: string;
}

/** What the run that produced the knowledge base used, as the harness measured it. */
export interface KnowledgeBaseRun {
  iterations: number;
  actions: number;
  durationMs: number;
}

/** The knowledge base the cartographer writes in the test repository. */
export interface KnowledgeBase extends KnowledgeBaseSubmission {
  formatVersion: KnowledgeBaseFormatVersion;
  /** Date and time of production, ISO 8601 in UTC. */
  producedAt: string;
  /** Name of the environment explored. */
  environment: string;
  model: KnowledgeBaseModel;
  run: KnowledgeBaseRun;
  /** `truncated` when a limit stopped the task or a source was not read. */
  status: "complete" | "truncated";
  sources: KnowledgeBaseSource[];
}

/** Why a knowledge base, or a submission, is refused. */
export interface KnowledgeBaseError {
  /** JSON Pointer (RFC 6901) to the offending location; the empty string designates the whole document. */
  path: string;
  message: string;
}

/** The outcome of a validation: the value, or every error found. */
export type KnowledgeBaseValidation<T> = { ok: true; value: T } | { ok: false; errors: KnowledgeBaseError[] };
