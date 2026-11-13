import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.ts";
import { HealthService } from "./health.service.ts";

/** The health route. */
@Module({ controllers: [HealthController], providers: [HealthService] })
export class HealthModule {}
