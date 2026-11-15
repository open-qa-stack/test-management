import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The files of the Playwright packages a test repository installs that document their API, relative to its `node_modules`. */
const REFERENCE_FILES = [join("playwright-core", "types", "types.d.ts"), join("playwright", "types", "test.d.ts")];

/** A member of the API of Playwright, as its reference documents it. */
export interface ReferenceMember {
  /** Its name, after the interface that holds it, such as `Locator.filter`. */
  readonly name: string;
  /** What the reference says of it, as plain text. */
  readonly description: string;
  /** How it is declared, with what the reference says of each of its options. */
  readonly signature: string;
}

/**
 * The reference of the API of Playwright, at the version a test repository installs.
 *
 * @remarks
 * The packages of Playwright document every member of their API in the type files they ship. Read from the
 * `node_modules` of the test repository, the reference is the one of the version its tests run with: what it
 * says exists there, and what it does not say does not, whatever an agent remembers of another version.
 */
export class PlaywrightReference {
  /** The version of `@playwright/test` installed, when its manifest could be read. */
  public readonly version: string | undefined;
  private readonly members: readonly ReferenceMember[];

  private constructor(version: string | undefined, members: readonly ReferenceMember[]) {
    this.version = version;
    this.members = members;
  }

  /**
   * Reads the reference of the Playwright a test repository installs.
   *
   * @param repositoryRoot - Absolute path of the test repository.
   * @returns The reference; one without any member when the packages are not installed.
   */
  public static async load(repositoryRoot: string): Promise<PlaywrightReference> {
    const modules = join(repositoryRoot, "node_modules");
    const read = (path: string) => readFile(join(modules, path), "utf8").catch(() => "");
    const manifest = await read(join("@playwright", "test", "package.json"));
    const version = /"version":\s*"([^"]+)"/.exec(manifest)?.[1];
    const texts = await Promise.all(REFERENCE_FILES.map(read));
    return new PlaywrightReference(version, merged(texts.flatMap(membersOf)));
  }

  /**
   * The members that echo words, those that echo most first.
   *
   * @param query - Words, such as `filter visible` or `toBeVisible`.
   * @param most - Most members given.
   * @returns The members whose name, description or options hold one of the words, a name counting more.
   */
  public search(query: string, most: number): ReferenceMember[] {
    const words = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 2);
    const scored = this.members
      .map((member) => {
        const name = member.name.toLowerCase();
        // The options of a method are documented in how it is declared: what is looked for is often one of them.
        const text = `${member.description}\n${member.signature}`.toLowerCase();
        const score = words.reduce((total, word) => total + (name.includes(word) ? 5 : 0) + (text.includes(word) ? 1 : 0), 0);
        return { member, score };
      })
      .filter(({ score }) => score > 0);
    return scored
      .sort((first, second) => second.score - first.score)
      .slice(0, most)
      .map(({ member }) => member);
  }

  /**
   * One member, by its name.
   *
   * @param name - Its name, such as `Locator.filter`, in any case; the name of the member alone when one interface only has it.
   * @returns The member; `undefined` when the reference has none of that name, or several interfaces have one.
   */
  public member(name: string): ReferenceMember | undefined {
    const asked = name.trim().toLowerCase();
    const exact = this.members.find((member) => member.name.toLowerCase() === asked);
    if (exact !== undefined) return exact;
    const short = this.members.filter((member) => member.name.toLowerCase().endsWith(`.${asked}`));
    return short.length === 1 ? short[0] : undefined;
  }
}

/** The members a type file documents: each one of an interface that a comment comes before. */
function membersOf(text: string): ReferenceMember[] {
  const members: ReferenceMember[] = [];
  const lines = text.split("\n");
  let holder: string | undefined;
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at]!;
    const opened = /^(?:export )?interface (\w+)/.exec(line);
    if (opened !== null) holder = opened[1];
    else if (line.startsWith("}")) holder = undefined;
    if (holder === undefined || line !== "  /**") continue;
    const comment: string[] = [];
    for (at += 1; at < lines.length && lines[at] !== "   */"; at += 1) comment.push(lines[at]!.replace(/^ {3}\* ?/, ""));
    const declared: string[] = [];
    // A member ends on the line, at its own indentation, that ends with a semicolon.
    for (at += 1; at < lines.length; at += 1) {
      declared.push(lines[at]!);
      if (/^ {2}\S.*;$/.test(lines[at]!)) break;
    }
    const name = /^ {2}(?:readonly )?(\w+)/.exec(declared[0] ?? "")?.[1];
    if (name !== undefined)
      members.push({
        name: `${holder}.${name}`,
        description: comment.join("\n").trim(),
        signature: declared.map((part) => part.replace(/^ {2}/, "")).join("\n"),
      });
  }
  return members;
}

/** The members, those of one name — the forms of a method — as one, each description once. */
function merged(members: readonly ReferenceMember[]): ReferenceMember[] {
  const byName = new Map<string, ReferenceMember>();
  for (const member of members) {
    const known = byName.get(member.name);
    byName.set(
      member.name,
      known === undefined
        ? member
        : {
            name: member.name,
            description: known.description.includes(member.description) ? known.description : `${known.description}\n\n${member.description}`,
            signature: `${known.signature}\n\n${member.signature}`,
          },
    );
  }
  return [...byName.values()];
}
