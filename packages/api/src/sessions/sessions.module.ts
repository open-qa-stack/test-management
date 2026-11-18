import { Logger, Module } from "@nestjs/common";
import { Sessions } from "@open-qa-stack/engine";
import { Database, SessionStore } from "@open-qa-stack/store";
import { ApiConfiguration } from "../config/api-configuration.ts";
import { DatabaseModule } from "../database/database.module.ts";
import { EventStreams } from "./event-streams.ts";
import { ProjectController } from "./project.controller.ts";
import { RunEnvironment } from "./run-environment.ts";
import { SessionsController } from "./sessions.controller.ts";
import { SessionsLifecycle } from "./sessions-lifecycle.ts";
import { StreamPace } from "./stream-pace.ts";

/**
 * The routes of the project and of the sessions, over the operations of the engine, which this process
 * hosts: the operations keep the sessions in the database of the instance, and run them in the test
 * repository the API was given. The routes hold no rule of the sessions: each calls one operation.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [ProjectController, SessionsController],
  providers: [
    EventStreams,
    RunEnvironment,
    SessionsLifecycle,
    StreamPace,
    { provide: SessionStore, inject: [Database], useFactory: (database: Database) => new SessionStore(database) },
    {
      provide: Sessions,
      inject: [SessionStore, ApiConfiguration, RunEnvironment],
      useFactory: (store: SessionStore, { repository }: ApiConfiguration, { env, runner, writerPace }: RunEnvironment) =>
        new Sessions({
          store,
          repository,
          env,
          logger: new Logger("Sessions"),
          ...(runner === undefined ? {} : { runner }),
          ...(writerPace === undefined ? {} : { writerPace }),
        }),
    },
  ],
})
export class SessionsModule {}
