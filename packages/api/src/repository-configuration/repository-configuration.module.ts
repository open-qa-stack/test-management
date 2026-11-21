import { Module } from "@nestjs/common";
import { Configuration, FileSecretStore, ModelConnection, RepositorySetup, Secrets } from "@open-qa-stack/engine";
import { ConfigurationStore } from "@open-qa-stack/store";
import { ApiConfiguration } from "../config/api-configuration.ts";
import { DatabaseModule } from "../database/database.module.ts";
import { ConfigurationController } from "./configuration.controller.ts";
import { RepositoryController } from "./repository.controller.ts";
import { SecretsController } from "./secrets.controller.ts";

/**
 * The routes of the configuration of the instance, over the operations of the engine: they keep its revisions in
 * the database of the instance, in step with the configuration file of the test repository the API was given.
 * The routes hold no rule of the configuration: each calls one operation. The values of the variables the configuration
 * names complete the environment the runs are given, which the test of a connection to the model reads the key of a
 * provider from.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [ConfigurationController, RepositoryController, SecretsController],
  providers: [
    {
      provide: Configuration,
      inject: [ConfigurationStore, ApiConfiguration],
      useFactory: (store: ConfigurationStore, { repository }: ApiConfiguration) => new Configuration(store, repository),
    },
    {
      provide: RepositorySetup,
      inject: [Configuration, ApiConfiguration],
      useFactory: (configuration: Configuration, { repository }: ApiConfiguration) => new RepositorySetup(repository, configuration),
    },
    {
      provide: Secrets,
      inject: [Configuration, ApiConfiguration],
      useFactory: (configuration: Configuration, { repository, runs }: ApiConfiguration) =>
        new Secrets(configuration, runs.env, repository === undefined ? undefined : FileSecretStore.of(repository)),
    },
    { provide: ModelConnection, inject: [Secrets], useFactory: (secrets: Secrets) => new ModelConnection(secrets) },
  ],
  exports: [Configuration, Secrets],
})
export class RepositoryConfigurationModule {}
