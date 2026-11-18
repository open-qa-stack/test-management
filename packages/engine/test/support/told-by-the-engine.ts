import { scriptedServer } from "@open-qa-stack/testing";
import { configText, FakeRunner, repository, type Script } from "@open-qa-stack/testing/test-repository";
import { journalLine, RunThread, traceLine, type RunEntry, type RunLine } from "@open-qa-stack/domain";
import { Configuration, liveRuntime, Run } from "../../src/index.ts";
import { MemoryConfigurationStore } from "./memory-configuration-store.ts";
import { MemoryDocumentStore } from "./memory-document-store.ts";
import type { SessionEvent, UnrankedEvent } from "@open-qa-stack/domain/sessions";
import { ENV } from "./hosted.ts";

/** What a run told, and the test repository it ran in. */
export interface Told {
  readonly events: UnrankedEvent[];
  readonly root: string;
}

/**
 * Runs the engine alone, as a host that keeps everything in memory, and writes the thread of what it told:
 * the journal it has kept and the traces of its agents, as the command line writes them to its files.
 *
 * @param replies - What the model answers, in order.
 * @param request - What to test, in the words of the person.
 * @param script - What the doubles of npm and Playwright answer.
 * @returns The events of the thread, without ranks.
 */
export async function toldByTheEngine(replies: Parameters<typeof scriptedServer>[0], request: string, script: Script = {}): Promise<Told> {
  const server = await scriptedServer(replies);
  const root = repository(configText(server.baseUrl));
  const thread = new RunThread();
  const events: UnrankedEvent[] = [];
  const tell = (line: RunLine | undefined): void => void (line === undefined || events.push(...thread.add(line)));
  let kept = false;
  try {
    await new Run({
      repositoryRoot: root,
      configuration: new Configuration(new MemoryConfigurationStore(), root),
      documents: new MemoryDocumentStore(),
      brief: request,
      environment: "local",
      env: ENV,
      journal: {
        location: () => "memory",
        keep: (_run, earlier: readonly RunEntry[]) => {
          kept = true;
          for (const entry of earlier) tell(journalLine(JSON.stringify(entry)));
        },
        entry: (entry) => {
          if (kept) tell(journalLine(JSON.stringify(entry)));
        },
      },
      follow: (line) => tell(traceLine(JSON.stringify(line))),
      openInbox: () => ({ pending: () => [], heard: () => [], delivered: () => undefined }),
      store: { write: async () => undefined },
      openRuntime: (config) => liveRuntime(config, {}),
      runner: new FakeRunner(root, script),
    }).run();
  } finally {
    await server.close();
  }
  return { events, root };
}

/**
 * What an event says, without what differs from a run to another: its rank, its date, how long an action
 * took, the folder of the test repository, written `<repository>`, and the date in the name of a branch.
 *
 * @param event - The event.
 * @param root - The test repository of its run.
 * @returns The event, comparable with that of another run of the same script.
 */
export function comparable(event: SessionEvent | UnrankedEvent, root: string): unknown {
  const { at: _at, ...said } = event as UnrankedEvent & { id?: number; durationMs?: number };
  delete said.id;
  if ("durationMs" in said) said.durationMs = 0;
  return JSON.parse(
    JSON.stringify(said)
      .replaceAll(root, "<repository>")
      .replaceAll(/\d{8}T\d{6}Z/g, "<date>"),
  );
}
