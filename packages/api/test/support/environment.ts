/** The environment the test process runs with: tests read it here, and nowhere else. */
export const TEST_ENVIRONMENT: NodeJS.ProcessEnv = process.env;

/**
 * The environment of a program a test starts: the given variables only, plus where coverage is collected.
 *
 * @param variables - The variables the program is started with.
 */
export function childEnvironment(variables: Readonly<Record<string, string>>): Record<string, string> {
  return { NODE_V8_COVERAGE: TEST_ENVIRONMENT["NODE_V8_COVERAGE"] ?? "", ...variables };
}
