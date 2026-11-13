import { Controller, Get } from "@nestjs/common";
import type { HealthStatus } from "./health-status.ts";
import { HealthService } from "./health.service.ts";

/** `GET /health`, open without authentication. */
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
}
