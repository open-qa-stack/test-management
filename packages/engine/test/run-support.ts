import { scriptedServer, type ScriptedServer } from "@open-qa-stack/testing";
import type { RunEntry, RunState, TraceLine } from "@open-qa-stack/domain";
import { liveRuntime, Run, type RunOptions } from "../src/index.ts";
import { MemoryJournal } from "./memory-journal.ts";
import { MemoryRunStore } from "./memory-run-store.ts";
import { configText, FakeRunner, FIRST_RUN, repository, WITNESS, type Script } from "@open-qa-stack/testing/test-repository";

export * from "@open-qa-stack/testing/test-repository";

/** What a host that keeps everything in memory holds of the runs of a test repository. */
interface MemoryHost {
  readonly store: MemoryRunStore;
  readonly journals: Map<string, RunEntry[]>;
}

const hosts = new Map<string, MemoryHost>();

/** The host of a test repository, the same from a run to the one that resumes it. */
export function hostOf(root: string): MemoryHost {
  const host = hosts.get(root) ?? { store: new MemoryRunStore(), journals: new Map<string, RunEntry[]>() };
  hosts.set(root, host);
  return host;
}

/** The ports of one run, and what the run told through them. */
export interface Plugged {
  readonly ports: Pick<RunOptions, "journal" | "print" | "openInbox" | "store">;
  /** The journal, as a person reads it. */
  readonly err: string;
  /** The summary. */
  readonly out: string;
}

/**
 * Plugs a run of a test repository into memory: its journal and its state are kept by the host of the
 * repository, and no one speaks to it.
 */
export function plugged(root: string): Plugged {
  const host = hostOf(root);
  const journal = new MemoryJournal(host.journals);
  let out = "";
  return {
    ports: {
      journal,
      print: (line) => (out += line),
      openInbox: () => ({ pending: () => [], heard: () => [], delivered: () => undefined, unreadable: undefined }),
      store: host.store,
    },
    get err() {
      return journal.lines;
    },
    get out() {
      return out;
    },
  };
}

export interface Ran {
  readonly code: number;
  readonly root: string;
  readonly err: string;
  readonly out: string;
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
    resume?: string;
    force?: boolean;
    follow?: (line: TraceLine) => void;
  } = {},
): Promise<Ran> {
  const server = await scriptedServer(replies);
  const modelUrl = setup.modelUrl ?? server.baseUrl;
  const config = setup.config === undefined ? configText(modelUrl) : setup.config(modelUrl);
  const root = (setup.root ?? repository)(config);
  const runner = new FakeRunner(root, setup.script);
  const host = plugged(root);
  try {
    const code = await new Run({
      repositoryRoot: root,
      ...(setup.environment === undefined ? {} : { environment: setup.environment }),
      ...(setup.brief === undefined ? {} : { brief: setup.brief }),
      ...(setup.resume === undefined ? {} : { resume: setup.resume }),
      ...(setup.force === undefined ? {} : { force: setup.force }),
      ...(setup.follow === undefined ? {} : { follow: setup.follow }),
      env: { SHOP_DB_URL: WITNESS },
      ...host.ports,
      openRuntime: (resolved) => liveRuntime(resolved, {}),
      runner,
      now: setup.now ?? (() => new Date("2026-11-13T12:00:00.000Z")),
    }).run();
    return { code, root, err: host.err, out: host.out, server, runner };
  } finally {
    await server.close();
  }
}

export const stateOf = (root: string, runId = FIRST_RUN) => hostOf(root).store.states.get(runId) as RunState;

export const journalOf = (root: string) => hostOf(root).journals.get(FIRST_RUN)!;
