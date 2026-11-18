import { Module } from "@nestjs/common";
import { ApiConfiguration } from "../config/api-configuration.ts";
import { SoloConfigurationCheck } from "../solo/solo-configuration-check.ts";
import { SoloSessionSource } from "../solo/solo-session-source.ts";
import { NoSessionSource } from "./no-session-source.ts";
import { ProjectController } from "./project.controller.ts";
import { SessionSource } from "./session-source.ts";
import { SessionsController } from "./sessions.controller.ts";
import { SessionsService } from "./sessions.service.ts";
import { StreamPace } from "./stream-pace.ts";

/**
 * The source the configuration names: the runs of the command line in a test repository when one is
 * configured, none otherwise. The source that reads the database of the instance will take their place here.
 */
function sourceOf(configuration: ApiConfiguration): SessionSource {
  const { soloRepository: repository, soloCommand: command, environmentWithoutSecrets: environment } = configuration;
  if (repository === undefined) return new NoSessionSource();
  return new SoloSessionSource({ repository, environment, ...(command === undefined ? {} : { command }) });
}

/** The routes of the project and of the sessions, and the source they read. */
@Module({
  controllers: [ProjectController, SessionsController],
  providers: [SessionsService, StreamPace, SoloConfigurationCheck, { provide: SessionSource, inject: [ApiConfiguration], useFactory: sourceOf }],
})
export class SessionsModule {}
