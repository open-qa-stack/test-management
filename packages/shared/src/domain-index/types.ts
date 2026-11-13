/** Version of the domain index format, independent of the product version. */
export type DomainIndexFormatVersion = 1;

/** Kind of a source the index lists: a knowledge source of the configuration, or the user interface of an application. */
export type IndexSourceType = "openapi" | "postgresql" | "document" | "source-code" | "web";

/** Whether the exploration covered a source. */
export type IndexSourceState = "read" | "not_read";

/** A source of the index: a knowledge source by its identifier, or an application's user interface by the application's identifier. */
export interface IndexSource {
  id: string;
  type: IndexSourceType;
  state: IndexSourceState;
  /** Fingerprint of the card the source was read from; a source not read has none. */
  cardFingerprint?: string;
}

/** Coarse references into one source: tags or path prefixes of a contract, tables of a base, URL paths of an interface, sections of a document, folders or files of source code. */
export interface SourceReferences {
  source: string;
  items: string[];
}

/** A functional domain of the application, and where to look for it. */
export interface IndexDomain {
  /** A slug, in English. */
  id: string;
  label: string;
  /** One sentence. */
  description: string;
  references: SourceReferences[];
}

/** What the agent hands in: the domains, and what it read but put in none. */
export interface DomainIndexSubmission {
  domains: IndexDomain[];
  unassigned: SourceReferences[];
}

/** The model the index was produced with, without any secret. */
export interface IndexModel {
  provider: string;
  baseUrl: string;
  model: string;
}

/** What the run that produced the index used, as the harness measured it. */
export interface IndexRun {
  iterations: number;
  actions: number;
  durationMs: number;
}

/** The domain index the cartographer writes in the test repository. */
export interface DomainIndex extends DomainIndexSubmission {
  formatVersion: DomainIndexFormatVersion;
  /** Date and time of production, ISO 8601 in UTC. */
  producedAt: string;
  /** Name of the environment explored. */
  environment: string;
  model: IndexModel;
  run: IndexRun;
  /** `truncated` when a limit stopped the task or a source was not read. */
  status: "complete" | "truncated";
  sources: IndexSource[];
}

/** Why an index, or a submission, is refused. */
export interface IndexError {
  /** JSON Pointer (RFC 6901) to the offending location; the empty string designates the whole document. */
  path: string;
  message: string;
}

/** The outcome of a validation: the value, or every error found. */
export type IndexValidation<T> = { ok: true; value: T } | { ok: false; errors: IndexError[] };
