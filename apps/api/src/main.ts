import { DatabaseUnavailableError, PendingMigrationsError } from "@open-qa-stack/store";
import { ConfigurationError } from "./config/configuration-error.ts";
import { environmentSettings } from "./config/environment-settings.ts";
import { processEnvironment } from "./config/process-environment.ts";
import { startApi } from "./start-api.ts";

try {
  await startApi({ ...environmentSettings(processEnvironment()), signals: ["SIGTERM", "SIGINT"] });
} catch (error) {
  if (!(error instanceof ConfigurationError || error instanceof PendingMigrationsError || error instanceof DatabaseUnavailableError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
