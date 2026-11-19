import assert from "node:assert/strict";
import { scriptedServer, type ScriptedServer } from "@open-qa-stack/testing";
import { configText, FakeRunner, repository, WITNESS, type RanCommand, type RanOutcome, type Script } from "@open-qa-stack/testing/test-repository";
import type { CommandRunner } from "@open-qa-stack/domain";
import type { Session, SessionEvent } from "@open-qa-stack/domain/sessions";
import { Configuration, Sessions, type SessionsHost } from "../../src/index.ts";
import { eventually } from "./eventually.ts";
import { held } from "./held.ts";
import { MemoryConfigurationStore } from "./memory-configuration-store.ts";
import { MemoryDocumentStore } from "./memory-document-store.ts";
import { MemoryExecutionStore } from "./memory-execution-store.ts";
import { MemorySessionStore } from "./memory-session-store.ts";
import { RecordingLogger } from "./recording-logger.ts";

/** The environment of the runs of the tests: the one variable the configuration of the test repository names. */
export const ENV = { SHOP_DB_URL: WITNESS };

/**
 * The paces of a host no test waits on: it never beats by itself within a test, and takes a host that did
 * not beat within the test for one that lives.
 */
export const STILL = { beatMs: 3_600_000, silentAfterMs: 3_600_000, followMs: 3_600_000 };

/** How a test sets the operations it hosts. */
export interface Setup {
  /** What the doubles of npm and Playwright answer. */
  readonly script?: Script;
  /** Called before a command of a run is answered, which waits for it: a test holds a run there. */
  readonly before?: (step: RanCommand) => Promise<void> | void;
  /** What the host gives besides its test repository, its store and its doubles. */
  readonly host?: Partial<SessionsHost>;
  /** The store of the sessions, when another host of the test reaches it too; one of its own by default. */
  readonly store?: MemorySessionStore;
}

/** A door a run waits at until a test opens it. */
export interface Door {
  /** Settles once the run reached the door. */
  readonly reached: Promise<void>;
  /** Holds a command of the run at the door when the command is one the door is for. */
  readonly hold: (step: RanCommand) => Promise<void>;
  /** Lets the run through, now and from then on. */
  open(): void;
}

/** Whether a command installs the dependencies of the test repository: what a design starts with, once the cartography is over. */
const installs = ({ command }: RanCommand): boolean => command[0] === "npm" && command[1] === "ci";

/** @returns A door the design of a run waits at, before it installs the dependencies of the test repository. */
export function designDoor(): Door {
  const reached = held();
  const opened = held();
  return {
    reached: reached.promise,
    hold: async (step) => {
      if (!installs(step)) return;
      reached.resolve();
      await opened.promise;
    },
    open: opened.resolve,
  };
}

/**
 * The operations on sessions as a test hosts them: a store kept in memory, a test repository, and a model
 * that answers as scripted.
 */
export class Hosted {
  readonly store: MemorySessionStore;
  /** The store of the revisions of the configuration of the test repository. */
  readonly configuration = new MemoryConfigurationStore();
  /** The store of the documents of the knowledge sources the instance keeps. */
  readonly documents = new MemoryDocumentStore();
  /** The store of the executions of tests the sessions ran. */
  readonly executions = new MemoryExecutionStore();
  readonly logger = new RecordingLogger();
  readonly server: ScriptedServer;
  /** The test repository the sessions run in. */
  readonly root: string;
  readonly sessions: Sessions;

  private constructor(server: ScriptedServer, setup: Setup) {
    this.server = server;
    this.store = setup.store ?? new MemorySessionStore();
    this.root = repository(configText(server.baseUrl));
    const doubles = new FakeRunner(this.root, setup.script);
    const runner: CommandRunner = {
      run: async (step): Promise<RanOutcome> => {
        await setup.before?.(step);
        return doubles.run(step);
      },
    };
    this.sessions = new Sessions({
      store: this.store,
      configuration: new Configuration(this.configuration, this.root),
      documents: this.documents,
      executions: this.executions,
      repository: this.root,
      env: ENV,
      logger: this.logger,
      runner,
      takesOver: true,
      writerPace: { firstRetryMs: 5, maxRetryMs: 20 },
      pace: STILL,
      ...setup.host,
    });
  }

  /**
   * @param replies - What the model answers, in order.
   * @param setup - How the operations are set.
   * @returns The operations, not started yet.
   */
  static async create(replies: Parameters<typeof scriptedServer>[0], setup: Setup = {}): Promise<Hosted> {
    return new Hosted(await scriptedServer(replies), setup);
  }

  /** Waits until a session ended, and gives it. */
  ended(id: string): Promise<Session> {
    return eventually(async () => {
      const session = await this.store.session(id);
      assert.ok(session !== undefined && (session.state === "completed" || session.state === "interrupted"), session?.state);
      return session;
    });
  }

  /** The events of a session, in order. */
  events(id: string): Promise<SessionEvent[]> {
    return this.store.eventsAfter(id, 0);
  }

  /** Stops the operations and the model. */
  async close(): Promise<void> {
    await this.sessions.stop(10_000);
    await this.server.close();
  }
}
