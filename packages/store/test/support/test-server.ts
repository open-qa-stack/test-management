import { randomBytes } from "node:crypto";
import { PostgresContainer } from "./postgres-container.ts";

/**
 * The PostgreSQL server the tests of a run create their databases on: one that already runs, when its URL is
 * given, or else a disposable one, started for the run and removed with it.
 */
export class TestServer {
  /** The name of the run, which labels every container the run starts. */
  readonly run = randomBytes(6).toString("hex");

  /**
   * @param given - The URL of a server that already runs, as a user allowed to create databases, when there is one.
   * @returns The URL of the server of the run.
   */
  async start(given: string | undefined): Promise<string> {
    if (given !== undefined && given !== "") return given;
    return (await PostgresContainer.start(this.run)).url;
  }

  /**
   * Removes every container the run started, those its tests started and those a start left half done
   * included, without yielding: a process that is about to exit can still call it.
   */
  remove(): void {
    PostgresContainer.removeRun(this.run);
  }
}
