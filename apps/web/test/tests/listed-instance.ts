import type { Execution, RepositoryTest, TestExecution, TestReading, TestVersion } from "@open-qa-stack/domain/sessions";
import type { Api } from "../built-console.ts";
import { ConfiguredInstance } from "../configuration/configured-instance.ts";
import { EXECUTIONS } from "../executions/executions-fixture.ts";
import { READING, TESTS } from "./tests-fixture.ts";

/** A capture, as the instance serves one: what it shows does not matter to the screen. */
const PIXEL = "";

/** The API of an instance whose test repository holds the tests and the executions of the fixtures, beside the configuration and the sessions of a configured instance. */
export class ListedInstance {
  /** The configuration and the sessions of the instance. */
  public readonly configured = new ConfiguredInstance();
  /** The tests of its repository. */
  public tests: readonly RepositoryTest[] = TESTS;

  /** The executions of its tests, the latest first. */
  public executions: readonly Execution[] = EXECUTIONS;

  /** The execution a page of them ends with, when one comes after it. */
  public next: string | undefined = "older";

  /** The versions of the tests of a file, the latest first. */
  public versions: readonly TestVersion[] = [];

  /** The test of the policies read in steps, from the run of an execution. */
  public reading: TestReading = { ...READING, ranAt: "2026-11-19T10:00:05.000Z" };

  /** What came of the tests of a file in each execution, the latest first: its results in the executions. */
  #ofFile(): readonly TestExecution[] {
    return this.executions.flatMap(({ report: _report, results, ...head }) => results.map((result) => ({ ...head, result })));
  }

  /** What the API answers. */
  public readonly api: Api = (request) => {
    if (request.path === "/api/tests") return { status: 200, body: JSON.stringify({ items: this.tests }) };
    if (request.path === "/api/tests/reading") return { status: 200, body: JSON.stringify(this.reading) };
    if (request.path === "/api/executions")
      return {
        status: 200,
        body: JSON.stringify({ items: this.executions, total: this.executions.length, start: 0, ...(this.next === undefined ? {} : { next: this.next }) }),
      };
    if (request.path.startsWith("/api/executions/")) {
      const execution = this.executions.find(({ id }) => request.path === `/api/executions/${id}`);
      return execution === undefined ? { status: 404, body: JSON.stringify({ code: "unknown_execution" }) } : { status: 200, body: JSON.stringify(execution) };
    }
    if (request.path === "/api/tests/executions") return { status: 200, body: JSON.stringify({ items: this.#ofFile() }) };
    if (request.path === "/api/tests/versions") return { status: 200, body: JSON.stringify({ items: this.versions }) };
    if (request.path === "/api/tests/capture") return { status: 200, contentType: "image/png", body: PIXEL };
    return this.configured.api(request);
  };
}
