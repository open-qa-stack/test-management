/** What starts the tag that names a test for good, such as `@oqas-id-3f0c2b9e-8d4a-4f1e-9b7a-2c5d6e7f8a90`. */
export const TEST_ID_TAG = "@oqas-id-";

/** A UUID as `crypto.randomUUID` writes it, in lower case. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The tag that names a test for good: it stays with the test when its title, its steps or its file change, so that
 * the instance keeps its history under it, and a run selects it with `--grep @oqas-id-<id>`.
 *
 * @param id - The identifier of the test, a UUID.
 * @returns The tag, with its `@`.
 */
export function testIdTag(id: string): string {
  return `${TEST_ID_TAG}${id}`;
}

/**
 * The identifier of a test, as its tags give it.
 *
 * @param tags - The tags of the test.
 * @returns The UUID of its first tag `@oqas-id-…` that holds one; `undefined` when none does.
 */
export function testIdOf(tags: readonly string[]): string | undefined {
  for (const tag of tags) {
    const id = tag.startsWith(TEST_ID_TAG) ? tag.slice(TEST_ID_TAG.length) : "";
    if (UUID.test(id)) return id;
  }
  return undefined;
}
