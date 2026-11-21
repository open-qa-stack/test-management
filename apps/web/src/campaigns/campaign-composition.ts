import type { CampaignTest, RepositoryTest } from "@open-qa-stack/domain/sessions";

/** What the list of the tests of the repository is narrowed to while a campaign is composed; each criterion left out keeps every test. */
export interface CompositionFilter {
  /** Words the title or the path of a test holds, whatever their case. */
  readonly words: string;
  readonly level?: string | undefined;
  readonly domain?: string | undefined;
  readonly application?: string | undefined;
  readonly tag?: string | undefined;
  /** Whether only the tests chosen are shown. */
  readonly chosenOnly: boolean;
}

/** The filter that keeps every test. */
export const EVERY_TEST: CompositionFilter = { words: "", chosenOnly: false };

/** What names a test in a choice: the path of its file and its title. */
export function testKey({ path, title }: CampaignTest): string {
  return `${path}\n${title}`;
}

/** The values each criterion of a filter may take among the tests of the repository, each once and in order. */
export interface CompositionFacets {
  readonly levels: readonly string[];
  readonly domains: readonly string[];
  readonly applications: readonly string[];
  readonly tags: readonly string[];
}

/** @returns The levels, domains, applications and tags the tests of the repository bear. */
export function facetsOf(tests: readonly RepositoryTest[]): CompositionFacets {
  const sorted = (values: readonly (string | undefined)[]): string[] =>
    [...new Set(values.filter((value) => value !== undefined))].sort((a, b) => a.localeCompare(b));
  return {
    levels: sorted(tests.map(({ level }) => level)),
    domains: sorted(tests.map(({ domain }) => domain)),
    applications: sorted(tests.flatMap(({ applications }) => applications)),
    tags: sorted(tests.flatMap(({ tags }) => tags)),
  };
}

/**
 * @param tests - The tests of the repository.
 * @param filter - What to narrow them to.
 * @param chosen - The keys of the tests chosen.
 * @returns The tests the filter keeps, in their order.
 */
export function filteredTests(tests: readonly RepositoryTest[], filter: CompositionFilter, chosen: ReadonlySet<string>): RepositoryTest[] {
  const words = filter.words.trim().toLowerCase();
  return tests.filter(
    (test) =>
      (words === "" || `${test.title}\n${test.path}`.toLowerCase().includes(words)) &&
      (filter.level === undefined || test.level === filter.level) &&
      (filter.domain === undefined || test.domain === filter.domain) &&
      (filter.application === undefined || test.applications.includes(filter.application)) &&
      (filter.tag === undefined || test.tags.includes(filter.tag)) &&
      (!filter.chosenOnly || chosen.has(testKey(test))),
  );
}

/** @returns Whether two choices hold the same tests, in whatever order. */
export function sameChoice(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

/** @returns The tests of a choice, as the instance takes them, from their keys. */
export function testsOfChoice(chosen: ReadonlySet<string>): CampaignTest[] {
  return [...chosen].map((key) => {
    const [path, ...title] = key.split("\n");
    return { path: path!, title: title.join("\n") };
  });
}
