import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { MAX_MEMBER_CHARS, PlaywrightReference, playwrightTools, playwrightVersion } from "../src/index.ts";

const CORE = `// A type file as the package ships it.
export interface Page {
  /**
   * Allows locating elements that contain given text.
   *
   * See also [locator.filter()](https://example.test) that allows to match by another criteria.
   * @param text Text to locate the element for.
   */
  getByText(text: string|RegExp, options?: {
    /**
     * Whether to find an exact match.
     */
    exact?: boolean;
  }): Locator;

  /**
   * **NOTE** Never wait for timeout in production.
   */
  waitForTimeout(timeout: number): Promise<void>;

  undocumented(): void;
}

export interface Locator {
  /**
   * This method narrows existing locator according to the options, for example filters by text.
   */
  filter(options?: {
    /**
     * Only matches visible or invisible elements.
     */
    visible?: boolean;
  }): Locator;

  /**
   * Click an element.
   */
  click(): Promise<void>;

  /**
   * Click an element, with a position.
   */
  click(options: { position: number }): Promise<void>;

  /**
   * ${"A long description. ".repeat(600)}
   */
  readonly long: string;
}

declare const outside: number;
`;
const TEST = `interface LocatorAssertions {
  /**
   * Ensures that the locator points to an attached and visible DOM node.
   */
  toBeVisible(): Promise<void>;
}

interface PageAssertions {
  /**
   * Ensures the page has the given title.
   */
  toHaveTitle(title: string): Promise<void>;

  /**
   * Click on the page, which no assertion does.
   */
  click(): Promise<void>;
}

interface Tail {
  /**
   * Said twice, without a full stop
   */
  twice(): void;

  /**
   * Said twice, without a full stop
   */
  twice(value: number): void;

  /**
   * A comment the file ends on, with no member after it.
   */`;

/** A test repository whose packages of Playwright ship the files given. */
function repository(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "playwright-reference-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, "node_modules", path)), { recursive: true });
    writeFileSync(join(root, "node_modules", path), content);
  }
  return root;
}

const installed = repository({
  "@playwright/test/package.json": JSON.stringify({ name: "@playwright/test", version: "1.64.1" }),
  "playwright-core/types/types.d.ts": CORE,
  "playwright/types/test.d.ts": TEST,
});
const bare = repository({});
after(() => {
  for (const root of [installed, bare]) rmSync(root, { recursive: true, force: true });
});

describe("the reference of the API of Playwright a test repository installs", () => {
  it("holds each documented member of each interface, under the name of its interface, the forms of a method as one", async () => {
    const reference = await PlaywrightReference.load(installed);
    assert.equal(reference.version, "1.64.1");
    const filter = reference.member("Locator.filter")!;
    assert.deepEqual(
      [filter.name, filter.description, filter.signature],
      [
        "Locator.filter",
        "This method narrows existing locator according to the options, for example filters by text.",
        "filter(options?: {\n  /**\n   * Only matches visible or invisible elements.\n   */\n  visible?: boolean;\n}): Locator;",
      ],
    );
    const click = reference.member("locator.click")!;
    assert.deepEqual(
      [click.description, click.signature],
      ["Click an element.\n\nClick an element, with a position.", "click(): Promise<void>;\n\nclick(options: { position: number }): Promise<void>;"],
    );
    // A member without a comment, and what is declared outside an interface, are none of the reference.
    assert.deepEqual([reference.member("Page.undocumented"), reference.member("outside")], [undefined, undefined]);
  });

  it("finds a member by its name alone when one interface has it, and none when several do or none does", async () => {
    const reference = await PlaywrightReference.load(installed);
    assert.deepEqual(
      [reference.member(" toBeVisible ")?.name, reference.member("click"), reference.member("toBeShown")],
      ["LocatorAssertions.toBeVisible", undefined, undefined],
    );
  });

  it("searches the names and the descriptions, a name counting more, and gives the most asked", async () => {
    const reference = await PlaywrightReference.load(installed);
    assert.deepEqual(
      reference.search("visible filter", 3).map((member) => member.name),
      ["Locator.filter", "LocatorAssertions.toBeVisible", "Page.getByText"],
    );
    assert.deepEqual(reference.search("a", 3), []);
    // Two forms of a method the reference says the same of are said once; a comment no member follows is none.
    assert.deepEqual(
      [reference.member("Tail.twice")!.description, reference.member("Tail.twice")!.signature],
      ["Said twice, without a full stop", "twice(): void;\n\ntwice(value: number): void;"],
    );
  });

  it("is empty, without a version, for a repository that installs no Playwright", async () => {
    const reference = await PlaywrightReference.load(bare);
    assert.deepEqual([reference.version, reference.search("click", 5), reference.member("Locator.click")], [undefined, [], undefined]);
  });
});

describe("the tools that read the reference of Playwright", () => {
  const tools = async (root: string) => {
    const [search, read] = playwrightTools(await PlaywrightReference.load(root));
    return {
      search: (query: string) => search!.execute({ query }),
      read: (member: string) => read!.execute({ member }),
      described: [search!.description, read!.description],
    };
  };

  it("name the version installed, list what echoes words with a sentence each, and give a member whole", async () => {
    const { search, read, described } = await tools(installed);
    assert.ok(described.every((description) => description.includes("version 1.64.1, the one installed")));
    assert.equal(
      await search("timeout visible"),
      [
        "- Page.waitForTimeout — **NOTE** Never wait for timeout in production.",
        "- LocatorAssertions.toBeVisible — Ensures that the locator points to an attached and visible DOM node.",
        "- Locator.filter — This method narrows existing locator according to the options, for example filters by text.",
      ].join("\n"),
    );
    assert.equal(
      await read("Locator.filter"),
      "Locator.filter\n\nThis method narrows existing locator according to the options, for example filters by text.\n\nfilter(options?: {\n  /**\n   * Only matches visible or invisible elements.\n   */\n  visible?: boolean;\n}): Locator;",
    );
  });

  it("say what the version does not have, with what is close, and cut a member too long", async () => {
    const { search, read } = await tools(installed);
    assert.deepEqual(await read("Locator.visible"), {
      error:
        "The API of Playwright (version 1.64.1, the one installed) has no member Locator.visible. Close to it: LocatorAssertions.toBeVisible, Locator.filter, Locator.click, Locator.long, Page.getByText.",
    });
    assert.deepEqual(await read("Zzz.qqq"), { error: "The API of Playwright (version 1.64.1, the one installed) has no member Zzz.qqq." });
    assert.equal(await search("twice"), "- Tail.twice — Said twice, without a full stop");
    assert.equal(
      await search("zzqx"),
      'Nothing of the API of Playwright (version 1.64.1, the one installed) echoes "zzqx". Try other words, such as the name of a method.',
    );
    const long = (await read("Locator.long")) as string;
    assert.match(long, /\n\n\[Cut at 8000 of \d+ characters\.\]$/);
    assert.equal(long.indexOf("\n\n[Cut at"), MAX_MEMBER_CHARS);
  });

  it("say so when no version could be read", async () => {
    const { described } = await tools(bare);
    assert.ok(described.every((description) => description.includes("(the version installed)")));
  });
});

describe("the version of Playwright the browser tools run with", () => {
  it("is that of the package installed, exact", () => {
    assert.match(playwrightVersion(), /^\d+\.\d+\.\d+$/);
  });
});
