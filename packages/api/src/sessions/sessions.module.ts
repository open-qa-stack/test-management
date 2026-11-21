import { Logger, Module } from "@nestjs/common";
import { Configuration, Secrets, Sessions } from "@open-qa-stack/engine";
import { DocumentStore, ExecutionStore, SessionStore } from "@open-qa-stack/store";
import { ApiConfiguration } from "../config/api-configuration.ts";
import { DatabaseModule } from "../database/database.module.ts";
import { RepositoryConfigurationModule } from "../repository-configuration/repository-configuration.module.ts";
import { EventStreams } from "./event-streams.ts";
import { LaunchesController } from "./launches.controller.ts";
import { ProjectController } from "./project.controller.ts";
import { RunEnvironment } from "./run-environment.ts";
import { SessionsController } from "./sessions.controller.ts";
import { SessionsLifecycle } from "./sessions-lifecycle.ts";
import { StreamPace } from "./stream-pace.ts";

/**
 * The routes of the project and of the sessions, over the operations of the engine, which this process
 * hosts: the operations keep the sessions in the database of the instance, and run those opened here in the
 * test repository the API was given, and so do the launches of tests, which take their turn. The routes hold no
 * rule of the sessions: each calls one operation.
 */
@Module({
  imports: [DatabaseModule, RepositoryConfigurationModule],
  controllers: [LaunchesController, ProjectController, SessionsController],
  providers: [
    EventStreams,
    RunEnvironment,
    SessionsLifecycle,
    StreamPace,
    {
      provide: Sessions,
      inject: [SessionStore, Configuration, DocumentStore, ExecutionStore, ApiConfiguration, RunEnvironment, Secrets],
      useFactory: (
        store: SessionStore,
        configuration: Configuration,
        documents: DocumentStore,
        executions: ExecutionStore,
        { repository }: ApiConfiguration,
        { runs }: RunEnvironment,
        secrets: Secrets,
      ) =>
        // The API stays: it takes over the sessions that wait for a host that died. Its runs read the environment it was
        // started with, completed with the values saved for the variables of the configuration, as each run starts.
        new Sessions({ ...runs, env: secrets, store, configuration, documents, executions, repository, takesOver: true, logger: new Logger("Sessions") }),
    },
  ],
  exports: [Sessions],
})
export class SessionsModule {}
