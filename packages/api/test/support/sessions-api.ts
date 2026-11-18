import type { LoggerService } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { Sessions } from "@open-qa-stack/engine";
import { AppModule } from "../../src/app.module.ts";
import { ApiConfiguration } from "../../src/config/api-configuration.ts";
import { RunEnvironment } from "../../src/sessions/run-environment.ts";
import { SessionsLifecycle } from "../../src/sessions/sessions-lifecycle.ts";
import { StreamPace } from "../../src/sessions/stream-pace.ts";

/** An API that listens on the loopback address, for the tests of its routes. */
export interface TestApi {
  /** The address of the API, without a path. */
  readonly url: string;
  /** Closes the API. */
  close(): Promise<void>;
}

/** How a test starts an API. */
export interface ApiSetup {
  /** The connection URL of its database; one nothing listens on by default, for an API on doubles. */
  readonly database?: string;
  /** The test repository its sessions run in; none by default. */
  readonly repository?: string;
  /** What its runs are given: the doubles of npm and Playwright, and the variables of the test repository. */
  readonly environment?: Partial<RunEnvironment>;
  /** A double of the operations on sessions, which then neither start nor stop with the API. */
  readonly operations?: object;
  /** Where the API logs; nowhere by default. */
  readonly logger?: LoggerService;
  /** The paces of its streams of events; those of the API by default. */
  readonly pace?: StreamPace;
}

/**
 * Starts the API on a free port, as the program does but for what a test replaces: what its runs are given,
 * so that no test calls npm, or the operations themselves, to put the routes before what a database does not
 * do on demand.
 *
 * @remarks
 * Its server drops every connection when it closes: the client of the tests opens a spare connection each time
 * it leaves a stream, and a connection nothing was asked on holds a graceful close back for seconds.
 *
 * @param setup - What the API is started with.
 * @returns The API, listening.
 */
export async function sessionsApi(setup: ApiSetup = {}): Promise<TestApi> {
  const { database = "postgres://oqas@127.0.0.1:1/oqas", repository, environment = {}, operations, logger, pace = new StreamPace() } = setup;
  const configuration = ApiConfiguration.read({
    OQAS_PORT: "1",
    OQAS_DATABASE_URL: database,
    ...(repository === undefined ? {} : { OQAS_REPOSITORY: repository }),
  });
  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(configuration)] })
    .overrideProvider(RunEnvironment)
    .useValue(Object.assign(new RunEnvironment(), { env: {}, ...environment }))
    .overrideProvider(StreamPace)
    .useValue(pace);
  if (operations !== undefined) builder = builder.overrideProvider(Sessions).useValue(operations).overrideProvider(SessionsLifecycle).useValue({});
  const module = await builder.setLogger(logger ?? { log() {}, error() {}, warn() {} }).compile();
  const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ forceCloseConnections: true }), { logger: logger ?? false });
  await app.listen(0, "127.0.0.1");
  return { url: await app.getUrl(), close: () => app.close() };
}
