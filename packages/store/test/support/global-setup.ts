import { TestServer } from "./test-server.ts";

/**
 * Gives the test files of a run their server, in `OQAS_TEST_DATABASE_URL`, and the name of the run, in
 * `OQAS_TEST_RUN`, before any of them starts.
 *
 * @remarks
 * The containers of the run are removed when the process exits, and not only when the run ends: interrupted
 * with `SIGINT` or `SIGTERM`, the test runner exits without calling what it was given to call at the end.
 *
 * @returns What removes the containers of the run once every test file ended.
 */
export default async function setup(): Promise<() => void> {
  const server = new TestServer();
  const remove = (): void => server.remove();
  process.once("exit", remove);
  process.env["OQAS_TEST_DATABASE_URL"] = await server.start(process.env["OQAS_TEST_DATABASE_URL"]);
  process.env["OQAS_TEST_RUN"] = server.run;
  return () => {
    process.off("exit", remove);
    remove();
  };
}
