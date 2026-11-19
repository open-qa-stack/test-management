import { hrefTo } from "../routing/route.ts";

/** The address of the screen of the tests. */
export const TESTS_PATH = "/tests";

/** The address of the screen of a test, whose path the query gives. */
export const TEST_PATH = `${TESTS_PATH}/view`;

/**
 * The link to the screen of a test.
 *
 * @param path - The path of the test, relative to the root of the test repository.
 * @returns The fragment to put in an `href`.
 */
export function testHref(path: string): string {
  return hrefTo(TEST_PATH, { path });
}

/**
 * The link to the screen of a test, showing the page at one of its steps.
 *
 * @param path - The path of the test, relative to the root of the test repository.
 * @param step - The number of the step, from 1.
 * @returns The fragment to put in an `href`.
 */
export function testStepHref(path: string, step: number): string {
  return hrefTo(TEST_PATH, { path, step: String(step) });
}
