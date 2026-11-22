import { Module } from "@nestjs/common";
import { RepositoryTests, TestReadings, TestSources } from "@open-qa-stack/engine";
import { ConfigurationStore, ExecutionStore, TestStore } from "@open-qa-stack/store";
import { ApiConfiguration } from "../config/api-configuration.ts";
import { DatabaseModule } from "../database/database.module.ts";
import { ExecutionsModule } from "../executions/executions.module.ts";
import { TestsController } from "./tests.controller.ts";

/**
 * The routes of the tests of the test repository, over the operations of the engine that read them from their files,
 * under the folder of the applications of the configuration in force, in steps from the reports of their runs, and by
 * the executions the instance keeps of them; and of their source, which a person reads and changes. The routes hold no
 * rule of their own.
 */
@Module({
  imports: [DatabaseModule, ExecutionsModule],
  controllers: [TestsController],
  providers: [
    {
      provide: RepositoryTests,
      inject: [ApiConfiguration, ConfigurationStore, TestStore],
      useFactory: ({ repository }: ApiConfiguration, configuration: ConfigurationStore, identities: TestStore) =>
        new RepositoryTests(repository, configuration, identities),
    },
    {
      provide: TestSources,
      inject: [ApiConfiguration, ConfigurationStore, RepositoryTests, TestStore],
      useFactory: ({ repository }: ApiConfiguration, configuration: ConfigurationStore, tests: RepositoryTests, identities: TestStore) =>
        new TestSources({ repository, configuration, tests, identities }),
    },
    {
      provide: TestReadings,
      inject: [ApiConfiguration, ConfigurationStore, ExecutionStore],
      useFactory: ({ repository }: ApiConfiguration, configuration: ConfigurationStore, executions: ExecutionStore) =>
        new TestReadings(repository, configuration, executions),
    },
  ],
})
export class TestsModule {}
