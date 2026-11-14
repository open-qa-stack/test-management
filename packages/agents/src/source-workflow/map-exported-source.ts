import type { AgentEvent, AgentRuntime, TaskLimits } from "@open-qa-stack/domain";
import type { ManifestDomain, SourceManifest } from "@open-qa-stack/shared";
import type { ExportedElement, SourceExport } from "@open-qa-stack/tools";
import type { Journal } from "../common/journal.ts";
import { cites, exportVocabulary } from "./cited-names.ts";
import { renderDomainFile } from "./domain-file.ts";
import { coverageErrors } from "./domain-file-control.ts";
import { exportManifest, type DomainFile } from "./export-manifest.ts";
import { addSessions, groupElements, type SessionsUse } from "./group-elements.ts";
import { resumedGrouping } from "./resumed-grouping.ts";
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
  /** Whether to map every element again, whatever an earlier run left. */
  readonly force: boolean;
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
 * Unless `force` is set, the workflow goes on from the manifest an earlier run left, when it can be read:
 * an element whose fingerprint did not change keeps its place, and only the others are placed again, each
 * told the domain it was in. The file of a domain is kept when the model wrote it, it still names every
 * element of the domain, and the domain neither gained, lost nor holds an element placed in this run; any
 * other is written again, and a domain left without element loses its file.
 *
 * The manifest is written with the export, after each batch and after each file, so that a run stopped
 * short is resumed from there. It is `complete` only when every element is set aside or in a domain whose
 * file, written by the model, names it; `truncated` otherwise.
 *
 * @param options - What the workflow needs.
 * @returns The manifest as it was last written, and what the sessions used.
 * @throws Error when a file cannot be written to the disk, or a session cannot be opened.
 */
export async function mapExportedSource(options: ExportedSourceOptions): Promise<SessionsUse & { readonly manifest: SourceManifest }> {
  const { source, exported, partial, folder, journal, now } = options;
  const previous = options.force ? undefined : await folder.readManifest();
  const { grouping, former } = resumedGrouping(previous, exported);
  const kept = new Set(exported.elements.filter((element) => grouping.isSettled(element.name)).map((element) => element.name));
  const files = new Map<string, DomainFile>();
  const parts = { source, exported, grouping, files };
  const record = () => folder.writeManifest(exportManifest({ ...parts, flawed: partial }, now()));
  await folder.writeExport(exported);
  await record();
  journal.record("info", `The export of ${source.id} and its manifest were written to ${folder.root}.`, source.id);
  if (kept.size > 0)
    journal.record("info", `${kept.size} of the ${exported.elements.length} elements of ${source.id} did not change; they keep their place.`, source.id);
  let used = await groupElements({ ...options, sourceId: source.id, grouping, former, afterBatch: record });
  const vocabulary = exportVocabulary(source.id, exported);
  const domains = grouping.populated();
  for (const { id } of previous?.domains ?? []) {
    if (domains.some((domain) => domain.id === id)) continue;
    await folder.removeDomain(id);
    journal.record("info", `The domain ${id} holds no element any more; its file was removed.`, source.id);
  }
  for (const domain of domains) {
    const members = exported.elements.flatMap((element) => {
      const state = grouping.state(element.name);
      return state !== undefined && "domain" in state && state.domain === domain.id ? [{ element, role: state.role }] : [];
    });
    if (await upToDate(domain, members, previous, kept, folder)) {
      files.set(domain.id, { file: folder.domainFile(domain.id), writtenBy: "model" });
      journal.record("info", `The file of the domain ${domain.id} is up to date; it was kept.`, source.id);
      continue;
    }
    const others = domains.filter((other) => other.id !== domain.id);
    const written = await writeDomain({ ...options, sourceId: source.id, domain, members, others, vocabulary });
    used = addSessions(used, written);
    const file = await folder.writeDomain(domain.id, renderDomainFile(domain, written.body), written.refusedBody);
    files.set(domain.id, { file, writtenBy: written.writtenBy, ...(written.refused === undefined ? {} : { refused: written.refused }) });
    journal.record("info", `The file of the domain ${domain.id} was written by the ${written.writtenBy}.`, source.id);
    await record();
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

/** Whether the file an earlier run left of a domain can be kept as it is. */
async function upToDate(
  domain: ManifestDomain,
  members: readonly { readonly element: ExportedElement }[],
  previous: SourceManifest | undefined,
  kept: ReadonlySet<string>,
  folder: SourceFolder,
): Promise<boolean> {
  const names = members.map(({ element }) => element.name);
  const before = (previous?.elements ?? []).filter((element) => element.domain === domain.id).map((element) => element.name);
  const written = previous?.domains.find((known) => known.id === domain.id)?.writtenBy;
  if (written !== "model" || names.some((name) => !kept.has(name)) || before.length !== names.length) return false;
  const text = await folder.readDomain(domain.id);
  return text !== undefined && names.every((name) => cites(text, name));
}
