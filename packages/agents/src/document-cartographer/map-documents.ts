import type { AgentEvent, AgentRuntime, TaskLimits, ToolDefinition } from "@open-qa-stack/domain";
import type { SourceManifest } from "@open-qa-stack/shared";
import { documentTools, type DocumentSet } from "@open-qa-stack/tools";
import { runAgentTask } from "../common/agent-task.ts";
import type { Journal } from "../common/journal.ts";
import { sessionUse, type SessionsUse } from "../source-workflow/group-elements.ts";
import type { SourceFolder } from "../source-workflow/source-folder.ts";
import { writeMap } from "../source-workflow/written-map.ts";
import { documentCartographerInstructions, documentMapRequest } from "./document-cartographer-prompt.ts";
import { DocumentMap } from "./document-map.ts";
import { DocumentWatch } from "./document-watch.ts";

/** What the cartography of the documents of a source needs. */
export interface MapDocumentsOptions {
  /** The source. */
  readonly source: SourceManifest["source"];
  /** Its documents. */
  readonly documents: DocumentSet;
  /** The folder of the source, in the test repository. */
  readonly folder: SourceFolder;
  /** The runtime that opens the session. */
  readonly runtime: AgentRuntime;
  /** The limits of the session. */
  readonly limits: TaskLimits;
  /** The notes the agent may take and read. */
  readonly notes: readonly ToolDefinition[];
  /** The secrets of the configuration, which no file may hold. */
  readonly secrets: readonly string[];
  /** Where what the harness checked, refused and wrote is written. */
  readonly journal: Journal;
  /** Receives each message sent to the agent, before it is sent. */
  readonly sent: (message: string) => void;
  /** Receives each event of the session, as it comes. */
  readonly received: (event: AgentEvent) => void;
  /** The clock of the manifest date. */
  readonly now: () => Date;
}

/**
 * Maps the documents of a source with the agent that reads them: one session, in which the agent walks the
 * tree, reads what it needs, chooses its elements and hands each domain in with its file.
 *
 * @remarks
 * The agent gets the tools of the documents of this source, watched, the notes, and the two tools of the
 * map. The harness cuts nothing beforehand: what the map holds once the session is over is written by
 * `writeMap`, in the same shape as for a source the harness exports itself.
 *
 * @param options - What the cartography needs.
 * @returns The manifest as it was written, and what the session used.
 * @throws Error when a file cannot be written to the disk, or the session cannot be opened.
 */
export async function mapDocuments(options: MapDocumentsOptions): Promise<SessionsUse & { readonly manifest: SourceManifest }> {
  const { source, documents, folder, journal, now } = options;
  const listing = await documents.list();
  const watch = new DocumentWatch(listing.files.map((file) => file.path));
  const sections = new Map(await Promise.all(listing.files.map(async ({ path }) => [path, await documents.sections(path)] as const)));
  const map = new DocumentMap({ sourceId: source.id, documents, files: listing.files, sections, watch, secrets: options.secrets, journal });
  const events: AgentEvent[] = [];
  const task = {
    instructions: documentCartographerInstructions(source.id),
    tools: [...watch.watched(documentTools(source.id, documents)), ...options.notes, ...map.tools()],
    request: documentMapRequest(source.id, listing.files),
    events,
    reminder: () => map.reminder(),
    sent: options.sent,
    received: options.received,
  };
  await runAgentTask(options.runtime, task, options.limits);
  const used = sessionUse(events);
  const last = events.at(-1)!;
  if (last.type === "stopped") journal.record("error", `The session that maps ${source.id} reached its ${last.reason.limit} limit.`, source.id);
  if (last.type === "error") journal.record("error", `The session that maps ${source.id} failed: ${last.error.message}`, source.id);
  const manifest = await writeMap({ source, folder, result: await map.result(), partial: listing.truncated, journal, now });
  return { ...used, manifest };
}
