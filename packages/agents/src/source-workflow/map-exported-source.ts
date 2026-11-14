import type { AgentEvent, AgentRuntime, TaskLimits } from "@open-qa-stack/domain";
import type { SourceManifest } from "@open-qa-stack/shared";
import type { SourceExport } from "@open-qa-stack/tools";
import type { Journal } from "../common/journal.ts";
import { exportManifest } from "./export-manifest.ts";
import { groupElements, type SessionsUse } from "./group-elements.ts";
import { Grouping } from "./grouping.ts";
import type { SourceFolder } from "./source-folder.ts";

/** What the workflow of a source that has an export needs. */
export interface ExportedSourceOptions {
  /** The source. */
  readonly source: SourceManifest["source"];
  /** Its export. */
  readonly exported: SourceExport;
  /** Whether the harness read only part of the source. */
  readonly partial: boolean;
  /** The folder of the source, in the test repository. */
  readonly folder: SourceFolder;
  /** The runtime that opens the sessions. */
  readonly runtime: AgentRuntime;
  /** The limits of each session. */
  readonly limits: TaskLimits;
  /** The secrets of the configuration, which no placement may hold. */
  readonly secrets: readonly string[];
  /** Where what the harness checked, closed and wrote is written. */
  readonly journal: Journal;
  /** Receives each message sent to the model, before it is sent. */
  readonly sent: (message: string) => void;
  /** Receives each event of each session, as it comes. */
  readonly received: (event: AgentEvent) => void;
  /** The clock of the manifest date. */
  readonly now: () => Date;
}

/**
 * Maps a source from its export: writes the export, groups its elements into domains batch by batch, and
 * records in the manifest where each element was left.
 *
 * @remarks
 * The manifest is written a first time with the export, `in_progress`, then once the grouping is over:
 * `complete` when every element is in a domain or set aside, `truncated` otherwise.
 *
 * @param options - What the workflow needs.
 * @returns The manifest as it was last written, and what the sessions used.
 * @throws Error when a file cannot be written to the disk, or a session cannot be opened.
 */
export async function mapExportedSource(options: ExportedSourceOptions): Promise<SessionsUse & { readonly manifest: SourceManifest }> {
  const { source, exported, partial, folder, journal, now } = options;
  const grouping = new Grouping();
  await folder.writeExport(exported);
  await folder.writeManifest(exportManifest(source, exported, grouping, partial, now()));
  journal.record("info", `The export of ${source.id} and its manifest were written to ${folder.root}.`, source.id);
  const used = await groupElements({ ...options, sourceId: source.id, grouping });
  const manifest = exportManifest(source, exported, grouping, partial, now());
  await folder.writeManifest(manifest);
  const count = (key: "domain" | "dismissed" | "unplaced") => manifest.elements.filter((element) => element[key] !== undefined).length;
  journal.record(
    manifest.status === "complete" ? "info" : "error",
    `The grouping of ${source.id} is ${manifest.status}: ${manifest.domains.length} domains, ${count("domain")} elements placed, ${count("dismissed")} set aside, ${count("unplaced")} unplaced.`,
    source.id,
  );
  return { ...used, manifest };
}
