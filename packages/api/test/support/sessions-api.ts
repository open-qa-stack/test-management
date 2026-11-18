import type { LoggerService } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module.ts";
import { ApiConfiguration } from "../../src/config/api-configuration.ts";
import { SessionSource } from "../../src/sessions/session-source.ts";
import { StreamPace } from "../../src/sessions/stream-pace.ts";

/** An API that listens on the loopback address, for the tests of its routes. */
export interface TestApi {
  /** The address of the API, without a path. */
  readonly url: string;
  /** Closes the API. */
  close(): Promise<void>;
}

/**
 * Starts the API on a free port, without its database, with the sessions of a given source.
 *
 * @remarks
 * Its server drops every connection when it closes: the client of the tests opens a spare connection each time
 * it leaves a stream, and a connection nothing was asked on holds a graceful close back for seconds.
 *
 * @param source - The source of the sessions.
 * @param logger - Where the API logs; nowhere by default.
 * @param pace - The paces of its streams of events; those of the API by default.
 * @returns The API, listening.
 */
export async function sessionsApi(source: SessionSource, logger: LoggerService | false = false, pace = new StreamPace()): Promise<TestApi> {
  const configuration = ApiConfiguration.read({ OQAS_PORT: "1", OQAS_DATABASE_URL: "postgres://oqas@127.0.0.1:1/oqas" });
  const module = await Test.createTestingModule({ imports: [AppModule.forRoot(configuration)] })
    .overrideProvider(SessionSource)
    .useValue(source)
    .overrideProvider(StreamPace)
    .useValue(pace)
    .setLogger(logger === false ? { log() {}, error() {}, warn() {} } : logger)
    .compile();
  const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ forceCloseConnections: true }), { logger });
  await app.listen(0, "127.0.0.1");
  return { url: await app.getUrl(), close: () => app.close() };
}
