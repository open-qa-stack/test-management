import { ConfigurationError } from "./config/configuration-error.ts";
import { processEnvironment } from "./config/process-environment.ts";
import { startApi } from "./start-api.ts";

try {
  await startApi(processEnvironment());
} catch (error) {
  if (!(error instanceof ConfigurationError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
