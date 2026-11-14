import type { AgentEvent, AgentRuntime, TaskLimits } from "@open-qa-stack/domain";
import type { SourceManifest } from "@open-qa-stack/shared";
import type { SourceExport } from "@open-qa-stack/tools";
import type { Journal } from "../common/journal.ts";
import { exportVocabulary } from "./cited-names.ts";
import { renderDomainFile } from "./domain-file.ts";
import { coverageErrors } from "./domain-file-control.ts";
import { exportManifest, type DomainFile } from "./export-manifest.ts";
import { addSessions, groupElements, type SessionsUse } from "./group-elements.ts";
import { Grouping } from "./grouping.ts";
import type { SourceFolder } from "./source-folder.ts";
import { writeDomain } from "./write-domain.ts";

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
  /** The secrets of the configuration, which no placement nor file may hold. */
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
 * Maps a source from its export: writes the export, groups its elements into domains batch by batch, has
 * the file of each domain written, checks that no element is lost, and records it all in the manifest.
 *
 * @remarks
 * The manifest is written a first time with the export, `in_progress`, then once the workflow is over. It
 * is `complete` only when every element is set aside or in a domain whose file, written by the model, names
 * it; `truncated` otherwise.
 *
 * @param options - What the workflow needs.
 * @returns The manifest as it was last written, and what the sessions used.
 * @throws Error when a file cannot be written to the disk, or a session cannot be opened.
 */
export async function mapExportedSource(options: ExportedSourceOptions): Promise<SessionsUse & { readonly manifest: SourceManifest }> {
  const { source, exported, partial, folder, journal, now } = options;
  const grouping = new Grouping();
  const files = new Map<string, DomainFile>();
  const parts = { source, exported, grouping, files };
  await folder.writeExport(exported);
  await folder.writeManifest(exportManifest({ ...parts, flawed: partial }, now()));
  journal.record("info", `The export of ${source.id} and its manifest were written to ${folder.root}.`, source.id);
  let used = await groupElements({ ...options, sourceId: source.id, grouping });
  const vocabulary = exportVocabulary(source.id, exported);
  for (const domain of grouping.domains()) {
    const members = exported.elements.flatMap((element) => {
      const state = grouping.state(element.name);
      return state !== undefined && "domain" in state && state.domain === domain.id ? [{ element, role: state.role }] : [];
    });
    const others = grouping.domains().filter((other) => other.id !== domain.id);
    const written = await writeDomain({ ...options, sourceId: source.id, domain, members, others, vocabulary });
    used = addSessions(used, written);
    const file = await folder.writeDomain(domain.id, renderDomainFile(domain, written.body), written.refusedBody);
    files.set(domain.id, { file, writtenBy: written.writtenBy, ...(written.refused === undefined ? {} : { refused: written.refused }) });
    journal.record("info", `The file of the domain ${domain.id} was written by the ${written.writtenBy}.`, source.id);
  }
  const texts = new Map<string, string>();
  for (const id of files.keys()) texts.set(id, (await folder.readDomain(id)) ?? "");
  const lost = coverageErrors(exportManifest({ ...parts, flawed: partial }, now()), texts);
  for (const error of lost) journal.record("error", `The last control of ${source.id} failed: ${error}`, source.id);
  const manifest = exportManifest({ ...parts, flawed: partial || lost.length > 0 }, now());
  await folder.writeManifest(manifest);
  const count = (key: "domain" | "dismissed" | "unplaced") => manifest.elements.filter((element) => element[key] !== undefined).length;
  journal.record(
    manifest.status === "complete" ? "info" : "error",
    `The mapping of ${source.id} is ${manifest.status}: ${manifest.domains.length} domains, ${count("domain")} elements placed, ${count("dismissed")} set aside, ${count("unplaced")} unplaced.`,
    source.id,
  );
  return { ...used, manifest };
}
