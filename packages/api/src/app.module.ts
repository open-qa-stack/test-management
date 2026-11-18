import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import type { ApiConfiguration } from "./config/api-configuration.ts";
import { ConfigurationModule } from "./config/configuration.module.ts";
import { DatabaseModule } from "./database/database.module.ts";
import { HealthModule } from "./health/health.module.ts";
import { ProblemFilter } from "./problems/problem.filter.ts";
import { RepositoryConfigurationModule } from "./repository-configuration/repository-configuration.module.ts";
import { SessionsModule } from "./sessions/sessions.module.ts";

/** The root module: it imports every module of the API, and answers the errors of all of them with a problem. */
@Module({})
export class AppModule {
  /** @param configuration - The configuration read at startup. */
  static forRoot(configuration: ApiConfiguration): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigurationModule.forRoot(configuration), DatabaseModule, HealthModule, RepositoryConfigurationModule, SessionsModule],
      providers: [{ provide: APP_FILTER, useClass: ProblemFilter }],
    };
  }
}
