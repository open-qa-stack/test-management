import { Module } from "@nestjs/common";
import { Campaigns, RepositoryTests, Sessions } from "@open-qa-stack/engine";
import { CampaignStore, ConfigurationStore, ExecutionStore, TestStore } from "@open-qa-stack/store";
import { ApiConfiguration } from "../config/api-configuration.ts";
import { DatabaseModule } from "../database/database.module.ts";
import { SessionsModule } from "../sessions/sessions.module.ts";
import { CampaignsController } from "./campaigns.controller.ts";

/**
 * The routes of the campaigns, over the operations of the engine, which keep them in the database of the instance, read
 * their tests from the test repository the API was given, and launch them in the turn of the sessions this process hosts.
 */
@Module({
  imports: [DatabaseModule, SessionsModule],
  controllers: [CampaignsController],
  providers: [
    {
      provide: Campaigns,
      inject: [CampaignStore, ExecutionStore, ApiConfiguration, ConfigurationStore, TestStore, Sessions],
      useFactory: (
        store: CampaignStore,
        executions: ExecutionStore,
        { repository }: ApiConfiguration,
        configuration: ConfigurationStore,
        identities: TestStore,
        sessions: Sessions,
      ) => new Campaigns({ store, executions, tests: new RepositoryTests(repository, configuration, identities), launcher: sessions }),
    },
  ],
})
export class CampaignsModule {}
