import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { closedPort } from "@open-qa-stack/testing";
import pg from "pg";
import { containerEngine } from "./container-engine.ts";

const run = promisify(execFile);
const COMPOSE_FILE = fileURLToPath(new URL("../../../../compose.yaml", import.meta.url));
const READY_WITHIN_MS = 60_000;
/** The label of every container the tests start. */
const TEST_LABEL = "oqas-test=1";
/** The label that ties a container to one run of the tests, named by `OQAS_TEST_RUN`. */
const RUN_LABEL = "oqas-test-run";

/** The PostgreSQL image of the development database, the version the tests run against. */
export function postgresImage(): string {
  const image = /^\s*image:\s*(\S+)\s*$/m.exec(readFileSync(COMPOSE_FILE, "utf8"))?.[1];
  if (image === undefined) throw new Error(`No image is named in ${COMPOSE_FILE}.`);
  return image;
}

/** A disposable PostgreSQL server in a container of its own, published on a loopback port. */
export class PostgresContainer {
  /** The URL of its `postgres` database, as its superuser. */
  readonly url: string;
  readonly #engine: string;
  readonly #name: string;

  private constructor(engine: string, name: string, url: string) {
    this.#engine = engine;
    this.#name = name;
    this.url = url;
  }

  /**
   * Starts a server with a random password, labelled with the run of the tests, and waits until it
   * accepts connections. A server that never does is removed.
   *
   * @param testRun - The run of the tests the server belongs to; by default, the one `OQAS_TEST_RUN` names.
   */
  static async start(testRun = process.env["OQAS_TEST_RUN"]): Promise<PostgresContainer> {
    const engine = containerEngine();
    const name = `oqas-test-postgres-${randomBytes(4).toString("hex")}`;
    const password = randomBytes(12).toString("hex");
    const port = await closedPort();
    const labels = ["--label", TEST_LABEL, ...(testRun === undefined || testRun === "" ? [] : ["--label", `${RUN_LABEL}=${testRun}`])];
    await run(engine, [
      "run",
      "--detach",
      "--name",
      name,
      ...labels,
      "--env",
      `POSTGRES_PASSWORD=${password}`,
      "--publish",
      `127.0.0.1:${port}:5432`,
      postgresImage(),
    ]);
    const container = new PostgresContainer(engine, name, `postgres://postgres:${password}@127.0.0.1:${port}/postgres`);
    try {
      await container.#ready();
    } catch (error) {
      await container.remove();
      throw error;
    }
    return container;
  }

  /**
   * Removes, with their data, the containers that a run of the tests started and left behind.
   *
   * @remarks
   * It answers once they are removed, without yielding: a process that is about to exit can still call it.
   */
  static removeRun(testRun: string): void {
    const engine = containerEngine();
    const listed = execFileSync(engine, ["ps", "--all", "--quiet", "--filter", `label=${RUN_LABEL}=${testRun}`], { encoding: "utf8" });
    const left = listed.split("\n").filter((id) => id !== "");
    if (left.length > 0) execFileSync(engine, ["rm", "--force", "--volumes", ...left], { stdio: "ignore" });
  }

  /** Stops the server; it no longer accepts connections. */
  async stop(): Promise<void> {
    await run(this.#engine, ["stop", "--time", "1", this.#name]);
  }

  /** Starts the stopped server again, and waits until it accepts connections. */
  async restart(): Promise<void> {
    await run(this.#engine, ["start", this.#name]);
    await this.#ready();
  }

  /** Removes the container and its data. */
  async remove(): Promise<void> {
    await run(this.#engine, ["rm", "--force", "--volumes", this.#name]);
  }

  async #ready(): Promise<void> {
    const deadline = Date.now() + READY_WITHIN_MS;
    for (;;) {
      const client = new pg.Client({ connectionString: this.url, connectionTimeoutMillis: 2000 });
      client.on("error", () => {});
      try {
        await client.connect();
        await client.query("select 1");
        return;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await delay(250);
      } finally {
        await client.end().catch(() => {});
      }
    }
  }
}
