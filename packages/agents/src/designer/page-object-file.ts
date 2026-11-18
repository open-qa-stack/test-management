import { className } from "@open-qa-stack/domain";
import type { LocatorMember } from "./locator-member.ts";

/** A member of a page object, as its file writes it: a getter, or a method given the names it needs. */
const MEMBER = /^ {2}(?:get )?(\w+)\(([^)]*)\): Locator \{\n {4}return this\.page\.(.+);\n {2}\}$/gm;

/** The class of the page object of a screen, and its file in the folder of the page objects of its application. */
export interface ScreenFile {
  /** Name of the class, such as `CustomersItemPage`. */
  readonly name: string;
  /** Name of the file, such as `customers-item.page.ts`. */
  readonly file: string;
}

/**
 * The page object of a screen, by its route: a record of the route is an item, and the first screen is home.
 *
 * @param route - The route of the screen, such as `/customers/:id`.
 * @returns Its class and its file.
 */
export function screenFile(route: string): ScreenFile {
  const words = route
    .replaceAll(":id", "item")
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
  const named = words.length === 0 ? ["home"] : words;
  return { name: `${className(named.join(" "), "screen")}Page`, file: `${named.join("-")}.page.ts` };
}

/** The text of a member, as the file of a page object holds it. */
function memberText(name: string, member: LocatorMember): string {
  const head = member.parameters.length === 0 ? `get ${name}()` : `${name}(${member.parameters.map((parameter) => `${parameter}: string`).join(", ")})`;
  return [`  ${head}: Locator {`, `    return this.page.${member.expression};`, "  }"].join("\n");
}

/**
 * The page object of one screen: the locators of its elements, each a member a test acts on.
 *
 * @remarks
 * A page object holds where the elements of a screen are, and nothing of what a test expects of them: the
 * assertions stay in the tests. A file already there is added to, never written again: what a person
 * changed in it stays, and a locator it already holds keeps its name.
 */
export class PageObjectFile {
  #content: string;

  /**
   * @param screen - The class and the file of the page object.
   * @param described - What the screen is, for the comment of a class written now, such as `/customers of Shop`.
   * @param existing - The text of the file, when the repository has it.
   */
  public constructor(screen: ScreenFile, described: string, existing?: string) {
    this.#content =
      existing ??
      [
        `import type { Locator, Page } from "@playwright/test";`,
        "",
        `/** The screen ${described}: where its elements are. What a test expects of them stays in the test. */`,
        `export class ${screen.name} {`,
        "  constructor(readonly page: Page) {}",
        "}",
        "",
      ].join("\n");
  }

  /** The text of the file. */
  public get content(): string {
    return this.#content;
  }

  /**
   * The name of the member of a locator, added to the class when it holds none for it.
   *
   * @param member - The member, with the name it would bear.
   * @returns The name it bears in the class: its own, or one with a number when another locator took it.
   */
  public member(member: LocatorMember): string {
    const held = [...this.#content.matchAll(MEMBER)].map(([, name, , expression]) => ({ name: name!, expression: expression! }));
    const same = held.find((other) => other.expression === member.expression);
    if (same !== undefined) return same.name;
    const taken = (name: string) => new RegExp(`\\b${name}\\b`).test(this.#content);
    let name = member.name;
    for (let number = 2; taken(name); number += 1) name = `${member.name}${number}`;
    this.#content = this.#content.replace(/\}\s*$/, `\n${memberText(name, member)}\n}\n`);
    return name;
  }
}
