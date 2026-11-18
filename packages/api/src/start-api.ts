import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { layOut } from "./api-layout.ts";
import { AppModule } from "./app.module.ts";
import { ApiConfiguration } from "./config/api-configuration.ts";
import type { StartApi } from "./api-entry.ts";

/**
 * Starts an API on the Fastify adapter, from its settings alone: the program of the package gives those it
 * read from its environment, a command those it read from its arguments, and both get the same application.
 */
export const startApi: StartApi = async (settings) => {
  const configuration = ApiConfiguration.of(settings);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(configuration), new FastifyAdapter(), {
    abortOnError: false,
    ...(settings.logger === undefined ? {} : { logger: settings.logger }),
  });
  await layOut(app, configuration.console);
  if (settings.signals !== undefined) app.enableShutdownHooks([...settings.signals]);
  try {
    await app.listen(configuration.port, configuration.host);
  } catch (error) {
    await app.close();
    throw error;
  }
  const url = await app.getUrl();
  new Logger("Api").log(`Listening on ${url}`);
  return { url, close: () => app.close() };
};
