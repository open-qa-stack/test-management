import type { RepositoryTest, TestReading } from "@open-qa-stack/domain/sessions";
import type { Api } from "../built-console.ts";
import { ConfiguredInstance } from "../configuration/configured-instance.ts";
import { READING, TESTS } from "./tests-fixture.ts";

/** A capture, as the instance serves one: what it shows does not matter to the screen. */
const PIXEL = "";

/** The API of an instance whose test repository holds the tests of the fixtures, beside the configuration and the sessions of a configured instance. */
export class ListedInstance {
  /** The configuration and the sessions of the instance. */
  public readonly configured = new ConfiguredInstance();
  /** The tests of its repository. */
  public tests: readonly RepositoryTest[] = TESTS;

  /** The test of the policies read in steps, from its latest run. */
  public reading: TestReading = READING;

  /** What the API answers. */
  public readonly api: Api = (request) => {
    if (request.path === "/api/tests") return { status: 200, body: JSON.stringify({ items: this.tests }) };
    if (request.path === "/api/tests/reading") return { status: 200, body: JSON.stringify(this.reading) };
    if (request.path === "/api/tests/capture") return { status: 200, contentType: "image/png", body: PIXEL };
    return this.configured.api(request);
  };
}
