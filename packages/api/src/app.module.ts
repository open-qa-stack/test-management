import { type DynamicModule, Module } from "@nestjs/common";
import type { ApiConfiguration } from "./config/api-configuration.ts";
import { ConfigurationModule } from "./config/configuration.module.ts";
import { DatabaseModule } from "./database/database.module.ts";
import { HealthModule } from "./health/health.module.ts";

/** The root module: it imports every module of the API. */
@Module({})
export class AppModule {
  /** @param configuration - The configuration read at startup. */
  static forRoot(configuration: ApiConfiguration): DynamicModule {
    return { module: AppModule, imports: [ConfigurationModule.forRoot(configuration), DatabaseModule, HealthModule] };
  }
}
