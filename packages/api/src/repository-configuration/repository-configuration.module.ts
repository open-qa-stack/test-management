import { Module } from "@nestjs/common";
import { Configuration } from "@open-qa-stack/engine";
import { ConfigurationStore } from "@open-qa-stack/store";
import { ApiConfiguration } from "../config/api-configuration.ts";
import { DatabaseModule } from "../database/database.module.ts";
import { ConfigurationController } from "./configuration.controller.ts";

/**
 * The routes of the configuration of the instance, over the operations of the engine: they keep its revisions in
 * the database of the instance, in step with the configuration file of the test repository the API was given.
 * The routes hold no rule of the configuration: each calls one operation.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [ConfigurationController],
  providers: [
    {
      provide: Configuration,
      inject: [ConfigurationStore, ApiConfiguration],
      useFactory: (store: ConfigurationStore, { repository }: ApiConfiguration) => new Configuration(store, repository),
    },
  ],
  exports: [Configuration],
})
export class RepositoryConfigurationModule {}
