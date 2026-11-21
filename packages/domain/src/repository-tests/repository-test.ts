/** A test the test repository holds, as its file tells it: what the screens of the tests list. */
export interface RepositoryTest {
  /** Its path, relative to the root of the test repository, such as `apps/shop/tests/orders/search/search-orders.spec.ts`. */
  readonly path: string;
  /** Its titles, those of the groups `test.describe` that hold it then its own, as `<describe>… › <title>`, as the runner reports it; the path of its file when the file names no test. */
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

/**
 * What keeps a file of the test repository from being listed as it is: a title two of its tests share, which the
 * runner and the results take as one test; or a syntax error, which keeps every test of the file from being read.
 */
export type RepositoryTestAnomaly =
  { readonly kind: "duplicate"; readonly path: string; readonly title: string } | { readonly kind: "unreadable"; readonly path: string };

/** The tests of the test repository, as `GET /tests` answers, with what keeps some of its files from being listed as they are. */
export interface RepositoryTestList {
  readonly items: readonly RepositoryTest[];
  readonly anomalies: readonly RepositoryTestAnomaly[];
}
