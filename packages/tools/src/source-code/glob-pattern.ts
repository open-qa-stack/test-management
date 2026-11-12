/** Longest glob an agent may give. */
export const MAX_GLOB_LENGTH = 200;
/** Most alternatives the braces of a glob may expand to. */
export const MAX_GLOB_ALTERNATIVES = 64;

/**
 * Turns a glob into a test on paths relative to a folder, written with `/`.
 *
 * @remarks
 * `**` matches any number of folders, `*` any characters but `/`, `?` one of them, and `{a,b}` either
 * text, braces nested or not. A glob without `/` matches the file name alone, wherever the file is:
 * `*.java` finds every Java file. A leading `./` or `/` is dropped. The match is computed segment by
 * segment without regular expressions, in time bounded by the lengths of the glob and the path, so that a
 * glob cannot stall the agent.
 *
 * @param glob - The glob.
 * @returns Whether a relative path matches it.
 * @throws Error when the glob is longer than `MAX_GLOB_LENGTH` or its braces expand to more than
 * `MAX_GLOB_ALTERNATIVES` alternatives.
 */
export function globMatcher(glob: string): (path: string) => boolean {
  if (glob.length > MAX_GLOB_LENGTH) throw new Error(`A glob may not be longer than ${MAX_GLOB_LENGTH} characters.`);
  const trimmed = glob.replace(/^\.?\//, "");
  const alternatives = expandBraces(trimmed).map((pattern) => pattern.split("/"));
  const byName = !trimmed.includes("/");
  return (path) => {
    const segments = byName ? [path.slice(path.lastIndexOf("/") + 1)] : path.split("/");
    return alternatives.some((pattern) => matchSegments(pattern, segments));
  };
}

/** A pair of braces with no other brace inside. */
const INNERMOST_BRACES = /\{([^{}]*)\}/;

/** The texts a glob stands for once its braces are expanded, innermost braces first. */
function expandBraces(glob: string): string[] {
  let globs = [glob];
  for (;;) {
    const next = globs.flatMap((text) => {
      const group = INNERMOST_BRACES.exec(text);
      if (group === null) return [text];
      const [braces, choices] = group as unknown as [string, string];
      return choices.split(",").map((choice) => text.slice(0, group.index) + choice + text.slice(group.index + braces.length));
    });
    if (next.length > MAX_GLOB_ALTERNATIVES) throw new Error(`The braces of a glob may not expand to more than ${MAX_GLOB_ALTERNATIVES} alternatives.`);
    if (next.length === globs.length && next.every((text, k) => text === globs[k])) return next;
    globs = next;
  }
}

/** Whether path segments match glob segments, `**` standing for any number of segments. */
function matchSegments(pattern: readonly string[], segments: readonly string[]): boolean {
  return matchSequence(pattern, segments, "**", (part, segment) => matchSegment(part, segment));
}

/** Whether one path segment matches one glob segment, `*` standing for any characters and `?` for one. */
function matchSegment(pattern: string, text: string): boolean {
  return matchSequence(pattern.split(""), text.split(""), "*", (char, actual) => char === "?" || char === actual);
}

/**
 * Whether a sequence matches a pattern in which `any` stands for any number of items, in time
 * proportional to the product of their lengths.
 */
function matchSequence<T>(pattern: readonly string[], items: readonly T[], any: string, matches: (part: string, item: T) => boolean): boolean {
  // reachable[j]: the pattern read so far can match the first j items.
  let reachable = Array.from({ length: items.length + 1 }, (_, j) => j === 0);
  for (const part of pattern) {
    const first = reachable.indexOf(true);
    reachable = part === any ? reachable.map((_, j) => first !== -1 && j >= first) : reachable.map((_, j) => j > 0 && reachable[j - 1]! && matches(part, items[j - 1]!));
  }
  return reachable[items.length]!;
}
