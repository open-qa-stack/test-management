import type { ManifestDomain, SourceManifest } from "@open-qa-stack/shared";
import type { SourceExport } from "@open-qa-stack/tools";
import type { Grouping } from "./grouping.ts";
import { EXPORT_FOLDER } from "./source-folder.ts";

/** The file of a domain: where it is, who wrote its body, and why when the harness did. */
export type DomainFile = Required<Pick<ManifestDomain, "file" | "writtenBy">> & Pick<ManifestDomain, "refused">;

/** What the manifest of a source is made of, as its workflow stands. */
export interface ManifestParts {
  /** The source. */
  readonly source: SourceManifest["source"];
  /** Its export. */
  readonly exported: SourceExport;
  /** The grouping of its elements. */
  readonly grouping: Grouping;
  /** The file of each domain written so far, by identifier of the domain. */
  readonly files: ReadonlyMap<string, DomainFile>;
  /** Whether the harness read only part of the source, or found at its last control an element no file names. */
  readonly flawed: boolean;
}

/**
 * Lists what the harness exported of a source, where the grouping left each element, and the file of each
 * domain.
 *
 * @remarks
 * The status is `truncated` when the source is flawed, an element was left unplaced or the harness wrote a
 * domain file itself; `in_progress` while an element is not settled or a domain has no file yet; and
 * `complete` otherwise.
 *
 * @param parts - What the manifest is made of.
 * @param producedAt - When the manifest is made.
 * @returns The manifest of the source: its domains, each with its file once written, and each element with
 * its fingerprint, the file of its definition from the folder of the source, and its domain and role, or
 * why it has none.
 */
export function exportManifest(parts: ManifestParts, producedAt: Date): SourceManifest {
  const { source, exported, grouping, files } = parts;
  const states = exported.elements.map((element) => grouping.state(element.name));
  const domains = grouping.domains().map((domain) => ({ ...domain, ...files.get(domain.id) }));
  const cut = parts.flawed || states.some((state) => state !== undefined && "unplaced" in state) || domains.some((domain) => domain.writtenBy === "harness");
  const pending = states.includes(undefined) || domains.some((domain) => domain.file === undefined);
  return {
    formatVersion: 1,
    source,
    fingerprint: exported.fingerprint,
    producedAt: producedAt.toISOString(),
    status: cut ? "truncated" : pending ? "in_progress" : "complete",
    domains,
    elements: exported.elements.map(({ name, kind, fingerprint, file }, i) => ({ name, kind, fingerprint, file: `${EXPORT_FOLDER}/${file}`, ...states[i] })),
  };
}
