/** Where a test is: its file and its titles. */
export interface TestPlace {
  /** The path of its file, relative to the root of the test repository. */
  readonly path: string;
  /** Its titles, as `<describe>… › <title>`. */
  readonly title: string;
}

/** A test of the repository that bears its identifier, where it is now, and where it was before when a change moved it. */
export interface IdentifiedTest extends TestPlace {
  /** Its identifier, the UUID of its tag `@oqas-id-…`. */
  readonly id: string;
  /** Where it was before a change the instance made to it; left out when it knows none. */
  readonly was?: TestPlace;
}

/** What keeps the tests of the instance under their identifiers, and their history with them. */
export interface TestStorePort {
  /**
   * Keeps where each test is, under its identifier. A test it kept elsewhere — or that was elsewhere, as its change
   * says — has been renamed or moved: the versions and the results of the tests kept under the former place, and the
   * campaigns that chose it, follow it to the new one, unless the new place already has versions of its own.
   *
   * @param tests - The tests, each identifier once.
   */
  identify(tests: readonly IdentifiedTest[]): Promise<void>;
}
