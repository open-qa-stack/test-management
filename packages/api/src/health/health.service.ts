import { Injectable } from "@nestjs/common";
import type { HealthStatus } from "./health-status.ts";

/** Tells whether the process serves requests, without revealing anything about it. */
@Injectable()
export class HealthService {
  /** @returns The status of a process that answers. */
  status(): HealthStatus {
    return { status: "ok" };
  }
}
