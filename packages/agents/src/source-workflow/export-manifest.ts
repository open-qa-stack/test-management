import type { SourceManifest } from "@open-qa-stack/shared";
import type { SourceExport } from "@open-qa-stack/tools";
import { EXPORT_FOLDER } from "./source-folder.ts";

/**
 * Lists what the harness exported of a source.
 *
 * @param source - The source.
 * @param exported - Its export.
 * @param truncated - Whether the harness read only part of the source.
 * @param producedAt - When the export was made.
 * @returns The manifest of the source: each element with its fingerprint and the file of its definition,
 * from the folder of the source.
 */
export function exportManifest(source: SourceManifest["source"], exported: SourceExport, truncated: boolean, producedAt: Date): SourceManifest {
  return {
    formatVersion: 1,
    source,
    fingerprint: exported.fingerprint,
    producedAt: producedAt.toISOString(),
    status: truncated ? "truncated" : "complete",
    elements: exported.elements.map(({ name, kind, fingerprint, file }) => ({ name, kind, fingerprint, file: `${EXPORT_FOLDER}/${file}` })),
  };
}
