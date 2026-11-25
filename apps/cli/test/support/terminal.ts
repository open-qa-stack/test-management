import { execFile } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { scriptedServer, type ScriptedServer } from "@open-qa-stack/testing";
import { configText, FakeRunner, markMapped, repository, WITNESS, type RanCommand, type RanOutcome, type Script } from "@open-qa-stack/testing/test-repository";
import type { SessionEvent } from "@open-qa-stack/domain/sessions";
import { Database, instanceDatabaseUrl } from "@open-qa-stack/store";
import { soloCommand, type CommandIo } from "../../src/index.ts";

export * from "@open-qa-stack/testing/test-repository";

const MAIN = fileURLToPath(new URL("../../src/main.ts", import.meta.url));

/** The paces of the commands the tests run in their own process: a beat and a reading every few milliseconds. */
export const QUICK = { beatMs: 15, silentAfterMs: 15_000, followMs: 15 };

/** What a command gave: its exit code, and what it wrote on its two outputs. */
export interface Ran {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** A door a run waits at until a test opens it. */
export interface Door {
  /** Settles once the run reached the door. */
  readonly reached: Promise<void>;
  /** Lets the run through, now and from then on. */
  readonly open: () => void;
}

/** How a test sets a terminal. */
export interface Setup {
  /** The configuration of the test repository, from the address of the model; `undefined` for a repository without one. */
  readonly config?: (modelUrl: string) => string | undefined;
  /** What the doubles of npm and Playwright answer. */
  readonly script?: Script;
}

/** How a test runs a command in its own process, besides its arguments. */
export interface Run {
  /** Variables added to the environment of the command. */
  readonly env?: Readonly<Record<string, string>>;
  /** What the command is given besides its environment, its folder and its outputs. */
  readonly io?: Partial<CommandIo>;
  /** Called with each text the command writes on its error output, as it writes it. */
  readonly heard?: (text: string) => void;
  /** Called with each text the command writes on its standard output, as it writes it. */
  readonly printed?: (text: string) => void;
}

/**
 * A terminal in a test repository of its own, whose model answers as scripted and whose npm and Playwright
 * are doubled: the tests run `oqas` in it, in their own process or as a program of its own.
 */
export class Terminal {
  readonly server: ScriptedServer;
  /** The test repository. */
  readonly root: string;
  /** The doubles of npm and Playwright, with the commands they were asked. */
  readonly runner: FakeRunner;
  #door: { readonly reached: () => void; readonly opened: Promise<void> } | undefined;

  private constructor(server: ScriptedServer, setup: Setup) {
    this.server = server;
    const config = setup.config === undefined ? configText(server.baseUrl) : setup.config(server.baseUrl);
    this.root = repository(config);
    // The commands that stay map the knowledge that waits: here none waits, and the sessions a test opens run at once.
    if (config !== undefined) markMapped(this.root);
    this.runner = new FakeRunner(this.root, setup.script);
  }

  /**
   * @param replies - What the model answers, in order.
   * @param setup - How the terminal is set.
   * @returns The terminal, in a new test repository.
   */
  static async open(replies: Parameters<typeof scriptedServer>[0], setup: Setup = {}): Promise<Terminal> {
    return new Terminal(await scriptedServer(replies), setup);
  }

  /** @returns A door the design of a run waits at, before it installs the dependencies of the test repository. */
  designDoor(): Door {
    let reached = (): void => undefined;
    let open = (): void => undefined;
    const arrived = new Promise<void>((resolve) => (reached = resolve));
    const opened = new Promise<void>((resolve) => (open = resolve));
    this.#door = { reached, opened };
    return { reached: arrived, open };
  }

  /**
   * Runs `oqas` in the process of the tests, in the test repository, with the doubles of npm and Playwright.
   *
   * @param argv - The arguments, without the repository.
   * @param run - How the command is run.
   * @returns What the command gave.
   */
  async oqas(argv: readonly string[], run: Run = {}): Promise<Ran> {
    let out = "";
    let err = "";
    const runner = {
      run: async (step: RanCommand): Promise<RanOutcome> => {
        if (step.command[0] === "npm" && step.command[1] === "ci" && this.#door !== undefined) {
          this.#door.reached();
          await this.#door.opened;
        }
        return this.runner.run(step);
      },
    };
    const code = await soloCommand(["--repository", this.root, ...argv], {
      env: { SHOP_DB_URL: WITNESS, ...run.env },
      cwd: "/",
      stdout: {
        write: (text) => {
          out += text;
          run.printed?.(text);
        },
      },
      stderr: {
        write: (text) => {
          err += text;
          run.heard?.(text);
        },
      },
      runner,
      pace: QUICK,
      // The model of the chain is the scripted server, whose answers go to the sessions: the connection is played instead.
      probes: { github: () => Promise.resolve({ state: "connected" }), provider: () => Promise.resolve({ state: "connected" }) },
      ...run.io,
    });
    return { code, out, err };
  }

  /**
   * Runs `oqas` as a program of its own, in another process, in the test repository.
   *
   * @param argv - The arguments, without the repository.
   * @returns What the program gave.
   */
  program(...argv: string[]): Promise<Ran> {
    return program(["--repository", this.root, ...argv]);
  }

  /** The thread of a session as `oqas show` gives it to a program. */
  async thread(session: string): Promise<SessionEvent[]> {
    const shown = await this.oqas(["show", session, "--output", "json"]);
    return shown.out
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as SessionEvent);
  }

  /**
   * Settles once the process that hosts a session met the store, whole, after this is called: what another process
   * posted before is in its hands. Two beats of the host dated after the call tell so: the first began after it, and
   * the second is written only once the first meeting is over. It waits for that fact, not for a time: only the
   * timeout of the test stops it.
   *
   * @param session - The identifier of the session.
   */
  async met(session: string): Promise<void> {
    const database = new Database(instanceDatabaseUrl(undefined, this.root), { log: () => undefined, warn: () => undefined });
    const seen = async () =>
      (await database.kysely.selectFrom("sessions").select("host_seen_at").where("id", "=", session).executeTakeFirstOrThrow()).host_seen_at;
    try {
      let last = await seen();
      for (let beats = 0; beats < 2;) {
        await pause(QUICK.beatMs);
        const now = await seen();
        if (String(now) !== String(last)) beats++;
        last = now;
      }
    } finally {
      await database.close();
    }
  }

  /** Closes the model. */
  async close(): Promise<void> {
    await this.server.close();
  }
}

/**
 * Runs `oqas` as a program of its own, with the arguments given and nothing else.
 *
 * @param argv - Its arguments.
 * @param cwd - The folder it runs in; that of the tests by default.
 * @returns What the program gave.
 */
export function program(argv: readonly string[], cwd = process.cwd()): Promise<Ran> {
  return new Promise((resolve) =>
    execFile(process.execPath, [MAIN, ...argv], { cwd, encoding: "utf8", env: { PATH: process.env["PATH"], SHOP_DB_URL: WITNESS } }, (error, out, err) =>
      resolve({ code: error === null ? 0 : (error.code as number), out, err }),
    ),
  );
}

/** The identifier of the session a command that opened one named on its error output. */
export function sessionOf(err: string): string {
  return /^Session (session-\S+)$/m.exec(err)![1]!;
}
