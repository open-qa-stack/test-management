import type { IndexSourceType } from "../domain-index/types.ts";

/** Version of the source manifest format, independent of the product version. */
export type SourceManifestFormatVersion = 1;

/** A functional domain of one source, made while its elements were grouped. */
export interface ManifestDomain {
  /** A slug, in English. */
  id: string;
  label: string;
  /** One sentence. */
  description: string;
  /** The markdown file that tells what the source holds of the domain, as a path relative to the folder of the manifest. */
  file?: string;
  /** Who wrote the body of the file: the `model`, or the `harness` when the model gave none that passed the control. */
  writtenBy?: "model" | "harness";
  /** Why the harness wrote the file itself; a later run asks the model again. */
  refused?: string;
}

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
  /** Identifier of the domain it was placed in. */
  domain?: string;
  /** What it holds or does, in one line, when it is in a domain. */
  role?: string;
  /** Why the model set it aside, in no domain. */
  dismissed?: string;
  /** Why the harness left it without a place; a later run places it. */
  unplaced?: string;
}

/** The manifest of one source: the elements the harness exported from it, and where their grouping left each. */
export interface SourceManifest {
  formatVersion: SourceManifestFormatVersion;
  source: { id: string; type: IndexSourceType };
  /** Fingerprint of the source when it was exported. */
  fingerprint: string;
  /** Date and time of production, ISO 8601 in UTC. */
  producedAt: string;
  /**
   * `in_progress` while an element is not settled or a domain has no file yet; `truncated` when the harness
   * read only part of the source, left an element unplaced, wrote a domain file itself or found an element
   * no file names; `complete` when every element is set aside or in a domain whose file, written by the
   * model, names it.
   */
  status: "in_progress" | "truncated" | "complete";
  domains: ManifestDomain[];
  elements: ManifestElement[];
}

/** One element in what the model hands in for a batch: in a domain with its role, or set aside with a reason. */
export interface PlacementItem {
  /** Name of the element, as the batch gives it. */
  name: string;
  /** Identifier of its domain. */
  domain?: string;
  /** What it holds or does, in one line. */
  role?: string;
  /** Why it belongs to no domain, instead of a domain and a role. */
  reason?: string;
}

/** What the model hands in for a batch of elements: the new domains, and where each element goes. */
export interface PlacementSubmission {
  /** The domains that do not exist yet. */
  domains?: Pick<ManifestDomain, "id" | "label" | "description">[];
  items: PlacementItem[];
}
