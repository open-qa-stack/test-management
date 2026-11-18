import { Injectable } from "@nestjs/common";
import { DatabaseStatus } from "@open-qa-stack/store";
import type { HealthStatus } from "./health-status.ts";
import { NotReadyError } from "./not-ready-error.ts";
import type { Readiness } from "./readiness.ts";

/** Tells whether the process serves requests, and whether the instance is ready, without revealing anything else. */
@Injectable()
export class HealthService {
  readonly #database: DatabaseStatus;

  constructor(database: DatabaseStatus) {
    this.#database = database;
  }

  /** @returns The status of a process that answers. */
  status(): HealthStatus {
    return { status: "ok" };
  }

  /**
   * Checks that the database answers and has applied every migration.
   *
   * @returns The readiness of a ready instance.
   * @throws {@link NotReadyError} carrying the readiness when the instance is not ready.
   */
  async readiness(): Promise<Readiness> {
    const { check: database } = await this.#database.check();
    if (database !== "up") throw new NotReadyError({ status: "not_ready", checks: { database } });
    return { status: "ready", checks: { database } };
  }
}
