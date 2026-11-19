import { Module } from "@nestjs/common";
import { RepositoryTests, TestReadings } from "@open-qa-stack/engine";
import { ConfigurationStore } from "@open-qa-stack/store";
import { ApiConfiguration } from "../config/api-configuration.ts";
import { DatabaseModule } from "../database/database.module.ts";
import { TestsController } from "./tests.controller.ts";

/**
 * The routes of the tests of the test repository, over the operations of the engine that read them from their files,
 * under the folder of the applications of the configuration in force, and in steps from the reports of their runs.
 * The routes hold no rule of their own.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [TestsController],
  providers: [
    {
      provide: RepositoryTests,
      inject: [ApiConfiguration, ConfigurationStore],
      useFactory: ({ repository }: ApiConfiguration, configuration: ConfigurationStore) => new RepositoryTests(repository, configuration),
    },
    {
      provide: TestReadings,
      inject: [ApiConfiguration, ConfigurationStore],
      useFactory: ({ repository }: ApiConfiguration, configuration: ConfigurationStore) => new TestReadings(repository, configuration),
    },
  ],
})
export class TestsModule {}
