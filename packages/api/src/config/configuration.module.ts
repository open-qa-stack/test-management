import { type DynamicModule, Global, Module } from "@nestjs/common";
import { ApiConfiguration } from "./api-configuration.ts";

/** Provides the configuration read at startup to every module. */
@Global()
@Module({})
export class ConfigurationModule {
  /** @param configuration - The configuration read at startup. */
  static forRoot(configuration: ApiConfiguration): DynamicModule {
    return {
      module: ConfigurationModule,
      providers: [{ provide: ApiConfiguration, useValue: configuration }],
      exports: [ApiConfiguration],
    };
  }
}
