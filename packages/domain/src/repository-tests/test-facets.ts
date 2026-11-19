import type { RepositoryTest } from "./repository-test.ts";

/** What the tags of a test tell of it, by the prefix of each tag. */
export type TestFacets = Pick<RepositoryTest, "applications" | "level" | "domain" | "feature" | "kind" | "case" | "data">;

/** The facet each prefix of a tag gives, but the applications, which may be several. */
const SINGLE: Readonly<Record<string, Exclude<keyof TestFacets, "applications">>> = {
  level: "level",
  domain: "domain",
  feature: "feature",
  kind: "kind",
  case: "case",
  data: "data",
};

/**
 * What the tags of a test tell of it: each tag is `@<prefix>-<value>`, as the harness writes them from the scenario of
 * the test. A tag of another prefix, or one given twice, is left as it is in the tags; the first of a prefix counts.
 *
 * @param tags - The tags of the test.
 * @returns Its applications, each once in the order of its tags, and the value of each other prefix it has a tag of.
 */
export function testFacets(tags: readonly string[]): TestFacets {
  const facets: { -readonly [Key in keyof TestFacets]: TestFacets[Key] } = { applications: [] };
  const applications: string[] = [];
  for (const tag of tags) {
    const [, prefix, value] = /^@([a-z]+)-(.+)$/.exec(tag) ?? [];
    if (prefix === undefined || value === undefined) continue;
    if (prefix === "app") {
      if (!applications.includes(value)) applications.push(value);
      continue;
    }
    const facet = SINGLE[prefix];
    if (facet !== undefined && facets[facet] === undefined) facets[facet] = value;
  }
  return { ...facets, applications };
}
