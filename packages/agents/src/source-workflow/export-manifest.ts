import type { SourceManifest } from "@open-qa-stack/shared";
import type { SourceExport } from "@open-qa-stack/tools";
import type { Grouping } from "./grouping.ts";
import { EXPORT_FOLDER } from "./source-folder.ts";

/**
 * Lists what the harness exported of a source, and where the grouping left each element.
 *
 * @remarks
 * The status is `truncated` when the harness read only part of the source or left an element unplaced,
 * `in_progress` while an element is not settled yet, and `complete` otherwise.
 *
 * @param source - The source.
 * @param exported - Its export.
 * @param grouping - The grouping of its elements, as it stands.
 * @param partial - Whether the harness read only part of the source.
 * @param producedAt - When the manifest is made.
 * @returns The manifest of the source: its domains, and each element with its fingerprint, the file of its
 * definition from the folder of the source, and its domain and role, or why it has none.
 */
export function exportManifest(
  source: SourceManifest["source"],
  exported: SourceExport,
  grouping: Grouping,
  partial: boolean,
  producedAt: Date,
): SourceManifest {
  const states = exported.elements.map((element) => grouping.state(element.name));
  const unplaced = states.some((state) => state !== undefined && "unplaced" in state);
  return {
    formatVersion: 1,
    source,
    fingerprint: exported.fingerprint,
    producedAt: producedAt.toISOString(),
    status: partial || unplaced ? "truncated" : states.includes(undefined) ? "in_progress" : "complete",
    domains: grouping.domains(),
    elements: exported.elements.map(({ name, kind, fingerprint, file }, i) => ({ name, kind, fingerprint, file: `${EXPORT_FOLDER}/${file}`, ...states[i] })),
  };
}
