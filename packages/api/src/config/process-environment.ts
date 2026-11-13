/** @returns The environment of the current process: the only place the API reads it. */
export function processEnvironment(): NodeJS.ProcessEnv {
  return process.env;
}
