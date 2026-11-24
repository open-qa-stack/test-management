import { Controller, Get, UseFilters } from "@nestjs/common";
import type { HealthStatus } from "./health-status.ts";
import { HealthService } from "./health.service.ts";
import { NotReadyFilter } from "./not-ready.filter.ts";
import type { Readiness } from "./readiness.ts";

/** `GET /health` and `GET /health/ready`, open without authentication. */
@Controller("health")
export class HealthController {
  readonly #health: HealthService;

  constructor(health: HealthService) {
    this.#health = health;
  }

  /** @returns The status of the process. */
  @Get()
  status(): HealthStatus {
    return this.#health.status();
  }

  /** @returns Whether the instance is ready; an instance that is not is answered with `503` and the same body. */
  @Get("ready")
  @UseFilters(NotReadyFilter)
  readiness(): Promise<Readiness> {
    return this.#health.readiness();
  }
}
