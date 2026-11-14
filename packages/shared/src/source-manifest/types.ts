import type { IndexSourceType } from "../domain-index/types.ts";

/** Version of the source manifest format, independent of the product version. */
export type SourceManifestFormatVersion = 1;

/** An element the harness exported from a source: a table, a view or a routine of a database. */
export interface ManifestElement {
  /** Its name, exactly as the source gives it. */
  name: string;
  /** What it is, in one word of the source: `table`, `view`, `routine`. */
  kind: string;
  /** Fingerprint of its definition when it was exported; an element whose fingerprint is the same did not change. */
  fingerprint: string;
  /** File of its definition, as a path relative to the folder of the manifest, with forward slashes. */
  file: string;
}

/** The manifest of one source: the elements the harness exported from it, without the model. */
export interface SourceManifest {
  formatVersion: SourceManifestFormatVersion;
  source: { id: string; type: IndexSourceType };
  /** Fingerprint of the source when it was exported. */
  fingerprint: string;
  /** Date and time of production, ISO 8601 in UTC. */
  producedAt: string;
  /** `truncated` when the harness read only part of the source. */
  status: "complete" | "truncated";
  elements: ManifestElement[];
}
