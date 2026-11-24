import { Module } from "@nestjs/common";
import { Executions, PastRuns } from "@open-qa-stack/engine";
import { ConfigurationStore, ExecutionStore } from "@open-qa-stack/store";
import { ApiConfiguration } from "../config/api-configuration.ts";
import { DatabaseModule } from "../database/database.module.ts";
import { ExecutionsController } from "./executions.controller.ts";
import { ExecutionsLifecycle } from "./executions-lifecycle.ts";

/**
 * The routes of the executions of tests, over the operations of the engine that read them from the database of the
 * instance, which takes the past runs of the test repository when it starts.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [ExecutionsController],
  providers: [
    { provide: Executions, inject: [ExecutionStore], useFactory: (store: ExecutionStore) => new Executions(store) },
    {
      provide: PastRuns,
      inject: [ApiConfiguration, ConfigurationStore, ExecutionStore],
      useFactory: ({ repository }: ApiConfiguration, configuration: ConfigurationStore, store: ExecutionStore) =>
        new PastRuns(repository, configuration, store),
    },
    ExecutionsLifecycle,
  ],
  exports: [Executions],
})
export class ExecutionsModule {}
