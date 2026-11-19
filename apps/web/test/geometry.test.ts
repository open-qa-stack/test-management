import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "vitest";

const SOURCES = new URL("../src/", import.meta.url);
const TOKENS = "tokens.css";

/** The step of the grid every length of the console is a multiple of, in CSS pixels. */
const GRID = 4;

/** The size the type scale grows from, and the ratio between two of its steps: a major second. */
const TYPE_BASE = 14;
const TYPE_RATIO = 1.125;

/** The widths at which the tokens are read: a phone, then each width from which a sheet adds to its rules. */
const WIDTHS = [0, 720, 1100];

/**
 * The properties whose lengths a sheet takes from the tokens: what spaces (margins, paddings, gaps, insets and
 * offsets), what rounds, what sets the text (its size, the height of its line, its weight, its tracking), and
 * what draws a line or a shadow.
 */
const GEOMETRY =
  /^(?:(?:margin|padding|scroll-margin|scroll-padding|inset)(?:-[a-z]+)*|(?:row-|column-)?gap|top|right|bottom|left|border(?:-[a-z]+)*|outline(?:-offset|-width)?|font-size|line-height|font-weight|letter-spacing|box-shadow)$/;

/** A number in a value, with its unit if it has one. */
const NUMBER = /-?(?:\d+\.?\d*|\.\d+)[a-z%]*/gi;

/**
 * Reads the declarations of a style sheet, its comments left out.
 *
 * @param css - The sheet, or a part of it.
 * @returns Each property with its value, in order.
 */
function declarations(css: string): [property: string, value: string][] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+|[a-z-]+)\s*:\s*([^;{}]+)(?=[;}])/g)].map((m) => [m[1]!, m[2]!.trim()]);
}

/**
 * Lists the style sheets of the console.
 *
 * @param folder - The folder to read, under the sources.
 * @returns The path of each sheet, from the sources.
 */
function sheets(folder = ""): string[] {
  return readdirSync(new URL(folder, SOURCES), { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? sheets(`${folder}${entry.name}/`) : entry.name.endsWith(".css") ? [`${folder}${entry.name}`] : []))
    .sort();
}

/**
 * Finds what a value writes that is not a token. A value may hold tokens (`var(--name)`), what a device keeps for
 * itself (`env(…)`), keywords, `0`, percentages, and, inside `calc()`, the plain numbers that multiply or divide
 * a token. Any other number — a length, a weight, a ratio — is raw.
 *
 * @param value - The value of a declaration.
 * @returns The raw numbers of the value.
 */
function rawNumbers(value: string): string[] {
  const written = value.replace(/var\(--[\w-]+\)|env\([^)]*\)/g, "");
  return (written.match(NUMBER) ?? []).filter((number) => number !== "0" && !number.endsWith("%") && !(written.includes("calc(") && /^-?[\d.]+$/.test(number)));
}

/**
 * Lists what a sheet writes that the tokens should hold: the raw numbers of its geometry, and any custom
 * property, which only the tokens file declares.
 *
 * @param css - The sheet.
 * @returns Each offending declaration, as it is written.
 */
function offences(css: string): string[] {
  return declarations(css)
    .filter(([property, value]) => property.startsWith("--") || (GEOMETRY.test(property) && rawNumbers(value).length > 0))
    .map(([property, value]) => `${property}: ${value}`);
}

/**
 * Reads the tokens as they stand at a width: those of a phone, then what each wider screen changes.
 *
 * @param width - The width of the screen, in CSS pixels.
 * @returns Each token with its value.
 */
function tokensAt(width: number): Map<string, string> {
  const css = readFileSync(new URL(TOKENS, SOURCES), "utf8");
  const blocks = [...css.matchAll(/(?:@media \(min-width: (\d+)px\) \{\s*)?:root\s*\{([^}]*)\}/g)];
  return new Map(blocks.filter(([, from]) => Number(from ?? 0) <= width).flatMap(([, , block]) => declarations(block!)));
}

/**
 * Computes a token of a length: pixels, another token, or a sum of both in `calc()`.
 *
 * @param tokens - The tokens.
 * @param name - The name of the token.
 * @returns Its length in CSS pixels; not a number when it is no such length.
 */
function pixels(tokens: ReadonlyMap<string, string>, name: string): number {
  const terms = (tokens.get(name) ?? "").replace(/^calc\((.*)\)$/, "$1").split(" + ");
  return terms.reduce((sum, term) => {
    const token = /^var\((--[\w-]+)\)$/.exec(term);
    return sum + (token ? pixels(tokens, token[1]!) : /^\d+px$/.test(term) ? parseInt(term, 10) : Number.NaN);
  }, 0);
}

/**
 * Lists the tokens of a family, in the order they are declared.
 *
 * @param tokens - The tokens.
 * @param prefix - What the names of the family start with.
 * @returns The names of the family.
 */
function family(tokens: ReadonlyMap<string, string>, prefix: string): string[] {
  return [...tokens.keys()].filter((name) => name.startsWith(prefix));
}

describe("the geometry of the console comes from its tokens", () => {
  it("writes no raw length, radius, type size, line height, weight, line or shadow in a sheet, and declares no token outside the tokens file", () => {
    assert.deepEqual(
      sheets()
        .filter((sheet) => sheet !== TOKENS)
        .flatMap((sheet) => offences(readFileSync(new URL(sheet, SOURCES), "utf8")).map((offence) => `${sheet} — ${offence}`)),
      [],
    );
  });

  it("finds what a sheet writes instead of a token, and lets pass what is built from tokens", () => {
    const sheet = `
      /* A comment: with 12px; inside. */
      a { margin: 0 auto; padding: var(--space-2) 6px; gap: 0.5rem; top: -1px; border-radius: 50%; width: 30px }
      b { font-size: 13px; line-height: 1.45; font-weight: 600; border: 1px solid; box-shadow: 0 1px 2px var(--shadow-soft) }
      c { --local: var(--space-2); inset: calc(-1 * var(--space-2)) 0 50%; padding: max(var(--space-3), env(safe-area-inset-bottom)) }
      d { margin-block: calc((var(--control) - var(--tap)) / 2); line-height: var(--leading-body); border: 0; outline: var(--stroke) solid; letter-spacing: 0 }
      @media (min-width: 720px) { e { padding-left: 42px; scroll-margin: 4em 0 } }
    `;
    assert.deepEqual(offences(sheet), [
      "padding: var(--space-2) 6px",
      "gap: 0.5rem",
      "top: -1px",
      "font-size: 13px",
      "line-height: 1.45",
      "font-weight: 600",
      "border: 1px solid",
      "box-shadow: 0 1px 2px var(--shadow-soft)",
      "--local: var(--space-2)",
      "padding-left: 42px",
      "scroll-margin: 4em 0",
    ]);
  });

  it("reads every style sheet of the console", () => {
    assert.deepEqual(sheets(), [
      "agent/agent-home.css",
      "agent/session.css",
      "base.css",
      "configuration/configuration.css",
      "knowledge/knowledge.css",
      "shell/shell.css",
      "tests/tests.css",
      TOKENS,
      "ui/ui.css",
    ]);
  });
});

describe("the scale of the console holds its rules", () => {
  it("names each step of the spacing scale after its count of 4 px", () => {
    const tokens = tokensAt(0);
    const steps = family(tokens, "--space-");
    assert.ok(steps.length > 0);
    assert.deepEqual(
      steps.map((name) => pixels(tokens, name)),
      steps.map((name) => Number(name.slice("--space-".length)) * GRID),
    );
  });

  it("keeps on the grid, at every width, what the sheets space and size with", () => {
    for (const width of WIDTHS) {
      const tokens = tokensAt(width);
      const lengths = [...family(tokens, "--gap-"), ...family(tokens, "--picture"), ...family(tokens, "--column")];
      for (const name of [...lengths, "--gutter", "--pad", "--tap", "--control", "--row", "--bar", "--keyline", "--sidebar"]) {
        assert.equal(pixels(tokens, name) % GRID, 0, `${name} at ${width} px: ${tokens.get(name)}`);
      }
    }
  });

  it("sets apart what stands further in the thread by twice as much at least, from a line to a pass", () => {
    const tokens = tokensAt(0);
    const ladder = ["--gap-line", "--gap-row", "--gap-turn", "--gap-pass"].map((name) => pixels(tokens, name));
    assert.deepEqual(family(tokens, "--gap-").length, ladder.length);
    ladder.slice(1).forEach((step, index) => assert.ok(step >= 2 * ladder[index]!, `${step} px after ${ladder[index]} px`));
  });

  it("derives the keyline of the thread from the picture of an agent and the gap beside it", () => {
    for (const width of WIDTHS) {
      const tokens = tokensAt(width);
      assert.equal(tokens.get("--keyline"), "calc(var(--picture) + var(--space-3))");
      assert.equal(pixels(tokens, "--keyline"), pixels(tokens, "--picture") + pixels(tokens, "--space-3"));
    }
  });

  it("orders the radii from the least to the pill, each the one above less the padding of what holds it", () => {
    const tokens = tokensAt(0);
    const radii = family(tokens, "--radius-");
    assert.deepEqual(radii, ["--radius-inner", "--radius-control", "--radius-card", "--radius-panel", "--radius-pill"]);
    const [inner, control, card, panel, pill] = radii.map((name) => pixels(tokens, name)) as [number, number, number, number, number];
    assert.deepEqual(
      [inner, control, card, panel].filter((radius, index, all) => radius % GRID !== 0 || radius <= (all[index - 1] ?? 0)),
      [],
    );
    assert.ok(pill > panel);
    assert.equal(panel - pixels(tokens, "--space-2"), control, "a control in a panel, two steps from its edge");
    assert.equal(control - pixels(tokens, "--space-1"), inner, "what a row holds, one step from its edge");
  });

  it("takes every size of the text from one modular scale, in rising order, with a line on the grid for each", () => {
    const tokens = tokensAt(0);
    const sizes = family(tokens, "--type-");
    const scale = new Set(Array.from({ length: 16 }, (_, step) => Math.round(TYPE_BASE * TYPE_RATIO ** (step - 4))));
    assert.deepEqual(
      sizes,
      ["caption", "small", "body", "reading", "heading", "title", "display"].map((role) => `--type-${role}`),
    );
    for (const [index, name] of sizes.entries()) {
      const size = pixels(tokens, name);
      const line = pixels(tokens, name.replace("--type-", "--leading-"));
      assert.ok(scale.has(size), `${name}: ${size} px is not ${TYPE_BASE} px times a power of ${TYPE_RATIO}`);
      assert.ok(index === 0 || size > pixels(tokens, sizes[index - 1]!), `${name} is larger than the role before`);
      assert.ok(line % GRID === 0 && line >= size * 1.2, `${name}: a line of ${line} px for ${size} px`);
    }
    assert.equal(family(tokens, "--leading-").length, sizes.length);
  });

  it("sets the text in three weights at most", () => {
    assert.ok(family(tokensAt(0), "--weight-").length <= 3);
  });

  it("keeps what a finger presses 44 px high below 1100 px, and what is typed at 16 px", () => {
    for (const width of [0, 720]) {
      const tokens = tokensAt(width);
      const line = pixels(tokens, "--row") - 2 * pixels(tokens, "--hairline");
      assert.ok(pixels(tokens, "--tap") >= 44 && pixels(tokens, "--control") >= 44 && line >= 44, `${width}`);
    }
    for (const width of WIDTHS) assert.ok(pixels(tokensAt(width), "--type-reading") >= 16, `${width}`);
  });

  it("changes at a wider screen only tokens a phone declares", () => {
    const phone = tokensAt(0);
    assert.deepEqual(
      [...tokensAt(1100).keys()].filter((name) => !phone.has(name)),
      [],
    );
  });
});
