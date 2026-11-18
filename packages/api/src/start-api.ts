import { Logger, type LoggerService } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.ts";
import { ApiConfiguration } from "./config/api-configuration.ts";
import type { Environment } from "./config/environment-variable.ts";

/** How the API is started, besides its environment. */
export interface StartOptions {
  /** Where the API logs; the console when left out, nowhere when `false`. */
  readonly logger?: LoggerService | false;
}

/**
 * Reads the configuration, then starts the API on the Fastify adapter and listens on the configured
 * address. A database that cannot be reached does not stop the startup: the API starts, and reports
 * itself not ready until the database answers. `SIGTERM` and `SIGINT` close it, then the process exits
 * on that signal.
 *
 * @param env - The environment the configuration is read from.
 * @param options - How the API is started.
 * @returns The application, listening.
 * @throws {@link ConfigurationError} before anything starts, when the configuration is invalid.
 * @throws `PendingMigrationsError` before anything listens, when the database answers but has not
 * applied every versioned migration.
 */
export async function startApi(env: Environment, options: StartOptions = {}): Promise<NestFastifyApplication> {
  const configuration = ApiConfiguration.read(env);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(configuration), new FastifyAdapter(), {
    abortOnError: false,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  app.enableShutdownHooks(["SIGTERM", "SIGINT"]);
  try {
    await app.listen(configuration.port, configuration.host);
  } catch (error) {
    await app.close();
    throw error;
  }
  new Logger("Api").log(`Listening on ${configuration.host}:${configuration.port}`);
  return app;
}
