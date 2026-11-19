import type { RepositoryTest } from "@open-qa-stack/domain/sessions";
import type { Api } from "../built-console.ts";
import { ConfiguredInstance } from "../configuration/configured-instance.ts";
import { TESTS } from "./tests-fixture.ts";

/** The API of an instance whose test repository holds the tests of the fixtures, beside the configuration and the sessions of a configured instance. */
export class ListedInstance {
  /** The configuration and the sessions of the instance. */
  public readonly configured = new ConfiguredInstance();
  /** The tests of its repository. */
  public tests: readonly RepositoryTest[] = TESTS;

  /** What the API answers. */
  public readonly api: Api = (request) =>
    request.path === "/api/tests" ? { status: 200, body: JSON.stringify({ items: this.tests }) } : this.configured.api(request);
}
