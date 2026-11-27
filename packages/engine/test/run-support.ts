import { scriptedServer, type ScriptedServer, KeptMemories } from "@open-qa-stack/testing";
import type { Lesson, RunEntry, RunState, TraceLine } from "@open-qa-stack/domain";
import { Configuration, liveRuntime, Run, type RunOptions } from "../src/index.ts";
import { MemoryJournal } from "./memory-journal.ts";
import { MemoryRunStore } from "./memory-run-store.ts";
import { MemoryConfigurationStore } from "./support/memory-configuration-store.ts";
import { MemoryDocumentStore } from "./support/memory-document-store.ts";
import { configText, FakeRunner, FIRST_RUN, repository, WITNESS, type Script } from "@open-qa-stack/testing/test-repository";

export * from "@open-qa-stack/testing/test-repository";

/** What a host that keeps everything in memory holds of the runs of a test repository. */
interface MemoryHost {
  readonly store: MemoryRunStore;
  readonly configuration: Configuration;
  /** The documents of the knowledge sources the instance keeps. */
  readonly documents: MemoryDocumentStore;
  readonly journals: Map<string, RunEntry[]>;
}

const hosts = new Map<string, MemoryHost>();

/** The host of a test repository, the same from a run to the next. */
export function hostOf(root: string): MemoryHost {
  const host = hosts.get(root) ?? {
    store: new MemoryRunStore(),
    configuration: new Configuration(new MemoryConfigurationStore(), root),
    documents: new MemoryDocumentStore(),
    journals: new Map<string, RunEntry[]>(),
  };
  hosts.set(root, host);
  return host;
}

/** The ports of one run, and what the run told through them. */
export interface Plugged {
  readonly ports: Pick<RunOptions, "configuration" | "documents" | "journal" | "openInbox" | "store">;
  /** The journal, as a person reads it. */
  readonly err: string;
}

/**
 * Plugs a run of a test repository into memory: its configuration, its journal and its state are kept by the
 * host of the repository, and no one speaks to it.
 */
export function plugged(root: string): Plugged {
  const host = hostOf(root);
  const journal = new MemoryJournal(host.journals);
  return {
    ports: {
      configuration: host.configuration,
      documents: host.documents,
      journal,
      openInbox: () => ({ pending: () => [], heard: () => [], delivered: () => undefined }),
      store: host.store,
    },
    get err() {
      return journal.lines;
    },
  };
}

export interface Ran {
  readonly code: number;
  readonly root: string;
  readonly err: string;
  readonly server: ScriptedServer;
  readonly runner: FakeRunner;
}

/** Runs the engine in a test repository, against a model that answers as scripted, with npm and Playwright doubled. */
export async function ran(
  replies: readonly { body: unknown }[],
  setup: {
    config?: (modelUrl: string) => string | undefined;
    environment?: string;
    root?: (config: string | undefined) => string;
    script?: Script;
    modelUrl?: string;
    now?: () => Date;
    brief?: string;
    follow?: (line: TraceLine) => void;
    lessons?: readonly Lesson[];
  } = {},
): Promise<Ran> {
  const server = await scriptedServer(replies);
  const modelUrl = setup.modelUrl ?? server.baseUrl;
  const config = setup.config === undefined ? configText(modelUrl) : setup.config(modelUrl);
  const root = (setup.root ?? repository)(config);
  const runner = new FakeRunner(root, setup.script);
  const host = plugged(root);
  // A repository run again was given its file anew: it is taken, as oqas config import takes it.
  const { configuration } = hostOf(root);
  if ((await configuration.view()).revision !== undefined) await configuration.synchronise();
  try {
    const code = await new Run({
      memory: new KeptMemories(),
      repositoryRoot: root,
      ...(setup.environment === undefined ? {} : { environment: setup.environment }),
      ...(setup.brief === undefined ? {} : { brief: setup.brief }),
      ...(setup.lessons === undefined ? {} : { lessons: setup.lessons }),
      ...(setup.follow === undefined ? {} : { follow: setup.follow }),
      env: { SHOP_DB_URL: WITNESS },
      ...host.ports,
      openRuntime: (resolved) => liveRuntime(resolved, {}),
      runner,
      now: setup.now ?? (() => new Date("2026-11-13T12:00:00.000Z")),
    }).run();
    return { code, root, err: host.err, server, runner };
  } finally {
    await server.close();
  }
}

export const stateOf = (root: string, runId = FIRST_RUN) => hostOf(root).store.states.get(runId) as RunState;

export const journalOf = (root: string) => hostOf(root).journals.get(FIRST_RUN)!;
