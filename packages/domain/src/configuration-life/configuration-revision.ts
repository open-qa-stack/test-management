import type { OqasConfig } from "../config/types.ts";

/**
 * Where a revision of the configuration comes from: `file`, the configuration file of the test repository, read when it
 * changed; `console`, a change saved in the console; `command`, a command that wrote the revision in force back
 * to the file.
 */
export type RevisionOrigin = "file" | "console" | "command";

/** What a revision says of itself, besides its document. */
export interface RevisionSummary {
  /** Its number, from 1: the revision in force is the one with the highest. */
  readonly number: number;
  /** When it was recorded, as an ISO 8601 date. */
  readonly recordedAt: string;
  readonly origin: RevisionOrigin;
  /** The SHA-256 digest, in hexadecimal, of the configuration file the revision was read from or wrote. */
  readonly fileDigest: string;
}

/** A revision of the configuration of an instance: the whole document, as the configuration file holds it. */
export interface ConfigurationRevision extends RevisionSummary {
  /** The configuration, valid by the schema of the configuration file when it was recorded. */
  readonly document: OqasConfig;
}

/** What a command records as a revision: the store numbers and dates it. */
export type RevisionEntry = Pick<ConfigurationRevision, "origin" | "fileDigest" | "document">;
