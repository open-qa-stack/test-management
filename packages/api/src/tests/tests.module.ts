import { Module } from "@nestjs/common";
import { RepositoryTests } from "@open-qa-stack/engine";
import { ConfigurationStore } from "@open-qa-stack/store";
import { ApiConfiguration } from "../config/api-configuration.ts";
import { DatabaseModule } from "../database/database.module.ts";
import { TestsController } from "./tests.controller.ts";

/**
 * The route of the tests of the test repository, over the operation of the engine that reads them from their files,
 * under the folder of the applications of the configuration in force. The route holds no rule of its own.
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
  ],
})
export class TestsModule {}
