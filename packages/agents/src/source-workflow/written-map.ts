import type { SourceManifest } from "@open-qa-stack/domain";
import type { Journal } from "../common/journal.ts";
import { renderDomainFile } from "./domain-file.ts";
import { coverageErrors } from "./domain-file-control.ts";
import { exportManifest, type DomainFile } from "./export-manifest.ts";
import type { MapResult } from "./handed-in-map.ts";
import type { SourceFolder } from "./source-folder.ts";

/** What writing the map of a source needs. */
export interface WrittenMapOptions {
  /** The source. */
  readonly source: SourceManifest["source"];
  /** The folder of the source, in the test repository. */
  readonly folder: SourceFolder;
  /** What the map holds, once its session is over. */
  readonly result: MapResult;
  /** Whether the harness saw only part of the source. */
  readonly partial: boolean;
  /** Where what the harness checked and wrote is written. */
  readonly journal: Journal;
  /** The clock of the manifest date. */
  readonly now: () => Date;
}

/**
 * Writes the map an agent handed in of a source, in the same shape as for a source the harness exports
 * itself: the export, with the text of each element the agent chose and of each part in no domain, the file
 * of each domain, and the manifest.
 *
 * @remarks
 * A domain an earlier run left and this one does not hold loses its file. The manifest is `complete` when
 * every part is in a domain whose file, written by the agent, names its elements, or set aside; `truncated`
 * otherwise.
 *
 * @param options - What the writing needs.
 * @returns The manifest as it was written.
 * @throws Error when a file cannot be written to the disk.
 */
export async function writeMap(options: WrittenMapOptions): Promise<SourceManifest> {
  const { source, folder, journal, now } = options;
  const { exported, grouping, files: written } = options.result;
  const previous = await folder.readManifest();
  await folder.writeExport(exported);
  for (const { id } of previous?.domains ?? []) if (!written.has(id)) await folder.removeDomain(id);
  const files = new Map<string, DomainFile>();
  const texts = new Map<string, string>();
  for (const domain of grouping.populated()) {
    const { body, writtenBy, refused, refusedBody } = written.get(domain.id)!;
    const text = renderDomainFile(domain, body);
    files.set(domain.id, { file: await folder.writeDomain(domain.id, text, refusedBody), writtenBy, ...(refused === undefined ? {} : { refused }) });
    texts.set(domain.id, text);
  }
  const parts = { source, exported, grouping, files };
  const lost = coverageErrors(exportManifest({ ...parts, flawed: options.partial }, now()), texts);
  for (const error of lost) journal.record("error", `The last control of ${source.id} failed: ${error}`, source.id);
  const manifest = exportManifest({ ...parts, flawed: options.partial || lost.length > 0 }, now());
  await folder.writeManifest(manifest);
  const count = (key: "domain" | "dismissed" | "unplaced") => manifest.elements.filter((element) => element[key] !== undefined).length;
  journal.record(
    manifest.status === "complete" ? "info" : "error",
    `The mapping of ${source.id} is ${manifest.status}: ${manifest.domains.length} domains, ${count("domain")} elements placed, ${count("dismissed")} set aside, ${count("unplaced")} unplaced.`,
    source.id,
  );
  return manifest;
}
