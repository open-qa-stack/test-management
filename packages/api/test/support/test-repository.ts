import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "@open-qa-stack/domain";
import { scriptedServer, type ScriptedServer } from "@open-qa-stack/testing";
import { FakeRunner, fixtureConfig, fixtureRepository, WITNESS, type RanCommand, type RanOutcome } from "@open-qa-stack/testing/fixture-repository";
import type { RunEnvironment } from "../../src/sessions/run-environment.ts";

/** A door a run waits at until a test opens it. */
export interface Door {
  /** Settles once the run reached the door. */
  readonly reached: Promise<void>;
  /** Lets the run through, now and from then on. */
  open(): void;
}

/**
 * What the sessions of an API under test run with: a test repository, the application it targets, a model
 * that answers as scripted, and the doubles of npm and Playwright. No test calls a model nor installs anything.
 */
export class TestRepository {
  /** The absolute path of the test repository. */
  readonly root: string;
  readonly model: ScriptedServer;
  readonly #workspace: string;
  readonly #site: Server;
  #hold: (step: RanCommand) => Promise<void> = async () => undefined;

  private constructor(workspace: string, site: Server, model: ScriptedServer) {
    this.#workspace = workspace;
    this.#site = site;
    this.model = model;
    this.root = fixtureRepository(workspace, fixtureConfig(model.baseUrl, `http://127.0.0.1:${(site.address() as AddressInfo).port}`));
  }

  /**
   * @param replies - What the model answers, in order.
   * @returns The test repository, its application and its model started.
   */
  static async create(replies: Parameters<typeof scriptedServer>[0]): Promise<TestRepository> {
    const site = createServer((_request, response) => response.writeHead(200).end("ok"));
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    return new TestRepository(mkdtempSync(join(tmpdir(), "oqas-api-")), site, await scriptedServer(replies));
  }

  /** What the API gives its runs: the variable the configuration of the repository names, the doubles, and writes made again at once. */
  get environment(): Partial<RunEnvironment> {
    const doubles = new FakeRunner(this.root);
    const runner: CommandRunner = {
      run: async (step): Promise<RanOutcome> => {
        await this.#hold(step);
        return doubles.run(step);
      },
    };
    return { env: { SHOP_DB_URL: WITNESS }, runner, writerPace: { firstRetryMs: 5, maxRetryMs: 20 } };
  }

  /** @returns A door the design of the next run waits at, before it installs the dependencies of the test repository. */
  designDoor(): Door {
    let arrive: () => void = () => undefined;
    let open: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => (arrive = resolve));
    const opened = new Promise<void>((resolve) => (open = resolve));
    this.#hold = async ({ command }) => {
      if (command[0] !== "npm" || command[1] !== "ci") return;
      arrive();
      await opened;
    };
    return { reached, open };
  }

  /** Stops the application and the model, and removes the repository. */
  async close(): Promise<void> {
    await this.model.close();
    await new Promise<void>((resolve) => this.#site.close(() => resolve()));
    rmSync(this.#workspace, { recursive: true, force: true });
  }
}
