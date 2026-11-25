import type { AgentEvent, AgentRuntime, SourceManifest, TaskLimits, ToolDefinition } from "@open-qa-stack/domain";
import type { Journal } from "../common/journal.ts";
import type { SessionsUse } from "../source-workflow/group-elements.ts";
import { runMapSession } from "../source-workflow/map-session.ts";
import type { SourceFolder } from "../source-workflow/source-folder.ts";
import { writeMap } from "../source-workflow/written-map.ts";
import { applicationExplorerInstructions, explorationRequest } from "./application-explorer-prompt.ts";
import { ApplicationMap } from "./application-map.ts";
import { ScreenTrail, type ExplorationMode } from "./screen-trail.ts";

/** What the exploration of the user interface of an application needs. */
export interface MapApplicationOptions {
  /** The source: the application, as the manifest names it. */
  readonly source: SourceManifest["source"];
  /** Name of the environment explored. */
  readonly environment: string;
  /** Address of the user interface. */
  readonly uiUrl: string;
  /** What the exploration may do in this environment. */
  readonly mode: ExplorationMode;
  /** The browser tools of the application. */
  readonly browser: readonly ToolDefinition[];
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
 * Has the user interface of an application explored and mapped by an agent: one session, in which the agent
 * opens the screens with the browser, tries what a user does on them, and hands each domain in with its
 * elements, what it observed and its file.
 *
 * @remarks
 * The agent gets the browser tools of this application, watched and guarded by a `ScreenTrail`, the notes,
 * and the two tools of the map. The harness knows nothing of the interface beforehand: what the map holds
 * once the session is over is written by `writeMap`, in the same shape as for any other source.
 *
 * @param options - What the exploration needs.
 * @returns The manifest as it was written, and what the session used.
 * @throws Error when a file cannot be written to the disk, or the session cannot be opened.
 */
export async function mapApplication(options: MapApplicationOptions): Promise<SessionsUse & { readonly manifest: SourceManifest }> {
  const { source, folder, journal, now } = options;
  const trail = new ScreenTrail(source.id, options.uiUrl, options.mode);
  const map = new ApplicationMap({ sourceId: source.id, trail, secrets: options.secrets, journal });
  const task = {
    agent: "application-explorer" as const,
    instructions: applicationExplorerInstructions(source.id, options.mode),
    tools: [...trail.watched(options.browser), ...options.notes, ...map.tools()],
    request: explorationRequest(source.id, options.environment, options.uiUrl),
    reminder: () => map.reminder(),
    sent: options.sent,
    received: options.received,
  };
  const used = await runMapSession({ runtime: options.runtime, task, limits: options.limits, journal, sourceId: source.id, doing: "explores" });
  const manifest = await writeMap({ source, folder, result: await map.result(), partial: false, journal, now });
  return { ...used, manifest };
}
