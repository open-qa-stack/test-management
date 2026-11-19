/** A test the test repository holds, as its file tells it: what the screens of the tests list. */
export interface RepositoryTest {
  /** Its path, relative to the root of the test repository, such as `apps/shop/tests/orders/search/search-orders.spec.ts`. */
  readonly path: string;
  /** Its title; its path when the file gives none. */
  readonly title: string;
  /** The titles of its steps, in order. */
  readonly steps: readonly string[];
  /** Its tags, as the file gives them, such as `@level-functional`. */
  readonly tags: readonly string[];
  /** The applications it acts on, by their tags `@app-…`: several for a test that crosses them. */
  readonly applications: readonly string[];
  /** Its level of the pyramid of tests, by its tag `@level-…`, such as `functional`. */
  readonly level?: string;
  /** Its domain, by its tag `@domain-…`. */
  readonly domain?: string;
  /** Its functionality, by its tag `@feature-…`. */
  readonly feature?: string;
  /** What it verifies, by its tag `@kind-…`, such as `functional` or `visual`. */
  readonly kind?: string;
  /** Its case, by its tag `@case-…`, such as `nominal` or `negative`. */
  readonly case?: string;
  /** What it does to the data of the environment, by its tag `@data-…`: `read` or `write`. */
  readonly data?: string;
}

/** The tests of the test repository, as `GET /tests` answers. */
export interface RepositoryTestList {
  readonly items: readonly RepositoryTest[];
}
