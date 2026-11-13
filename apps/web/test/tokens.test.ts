import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright-core";

const APP = new URL("../", import.meta.url);
const TOKENS = "src/tokens.css";

/** The reference tokens of the design, by name, with their values. */
const REFERENCE_TOKENS = {
  "--bg": "#f4f5f7",
  "--surface": "#fff",
  "--line": "#e3e6eb",
  "--line-soft": "#eef0f3",
  "--text": "#1a1d23",
  "--text-2": "#4b5563",
  "--text-3": "#6b7280",
  "--text-4": "#9aa3b0",
  "--primary": "#2458d6",
  "--primary-soft": "#eef2fb",
  "--primary-line": "#c9d6f5",
  "--ok": "#15803d",
  "--ok-soft": "#e4f5ea",
  "--ko": "#b91c1c",
  "--ko-soft": "#fde8e8",
  "--warn": "#b45309",
  "--warn-soft": "#fdf0dc",
  "--ai": "#6d28d9",
  "--ai-soft": "#f1ecfd",
  "--ai-line": "#d9d0f5",
  "--neutral": "#5b6472",
  "--neutral-soft": "#eef0f3",
  "--r": "6px",
  "--row": "36px",
  "--fs": "13px",
};

/** The colours of the design beyond the reference tokens: hover states, faint backgrounds, field borders, overlays. */
const SECONDARY_COLOURS = [
  "#1a44ad",
  "#1f4dbd",
  "#faf8ff",
  "#fafbfc",
  "#d6dae1",
  "#f3dfb8",
  "#8a5a12",
  "#dfe6f7",
  "#dbe4fa",
  "#f6f7f9",
  "#fff5f5",
  "#f1b8b8",
  "#fffbf3",
  "#f4f7fe",
  "#f8f9fb",
  "#e9ecf1",
  "#9cc0ff",
  "rgba(20, 24, 33, 0.38)",
  "rgba(20, 24, 33, 0.25)",
  "rgba(0, 0, 0, 0.25)",
];

const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/gi;
const CSS_WIDE_KEYWORDS = new Set(["inherit", "initial", "unset", "revert", "revert-layer", "currentcolor", "transparent"]);
const SCANNED = /\.(?:css|html|svg|[cm]?[jt]sx?)$/;
/** Top-level folders left out: dependencies, build output, and the tests, whose fixtures hold colours on purpose. */
const SKIPPED = new Set(["node_modules", "dist", "test"]);
const ATTRIBUTE_VALUE = /=\s*(?:"([^"]*)"|'([^']*)')/g;
const STYLE_ELEMENT = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const STRING_LITERAL = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;

function read(path: string, root: URL = APP): string {
  return readFileSync(new URL(path, root), "utf8");
}

function declarations(css: string): [property: string, value: string][] {
  return [...css.matchAll(/(--[\w-]+|[a-z-]+)\s*:\s*([^;{}]+)(?=[;}])/g)].map((m) => [m[1]!, m[2]!.trim()]);
}

function rootDeclarations(): Map<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(read(TOKENS));
  assert.ok(root, `${TOKENS} declares :root`);
  return new Map(declarations(root[1]!));
}

function literalColours(text: string): string[] {
  return [...text.matchAll(COLOUR_LITERAL)].map((m) => m[0]);
}

function captured(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((m) => m.slice(1).find((group) => group !== undefined) ?? "");
}

/** The values of a file where a colour could be written: CSS declarations, markup attributes, string literals. */
function values(file: string, text: string): string[] {
  if (file.endsWith(".css")) return declarations(text).map(([, value]) => value);
  if (/\.(?:html|svg)$/.test(file)) {
    return [...captured(text, ATTRIBUTE_VALUE), ...captured(text, STYLE_ELEMENT).flatMap((css) => declarations(css).map(([, value]) => value))];
  }
  return captured(text, STRING_LITERAL);
}

async function namedColours(file: string, text: string): Promise<string[]> {
  const words = values(file, text)
    .flatMap((value) => value.match(/[a-z][a-z-]*/gi) ?? [])
    .filter((word) => !CSS_WIDE_KEYWORDS.has(word.toLowerCase()));
  assert.ok(browser, "the browser is started");
  const page = await browser.newPage();
  try {
    return await page.evaluate((all) => all.filter((word) => CSS.supports("color", word)), words);
  } finally {
    await page.close();
  }
}

function sources(root: URL = APP, folder = ""): string[] {
  return readdirSync(new URL(folder, root), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${folder}${entry.name}`;
      if (entry.isDirectory()) return folder === "" && SKIPPED.has(entry.name) ? [] : sources(root, `${path}/`);
      return SCANNED.test(path) && path !== TOKENS ? [path] : [];
    })
    .sort();
}

let browser: Browser | undefined;

before(async () => {
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
});

describe("criterion 3 — the design tokens are CSS custom properties, and the only place a colour is written", () => {
  it("declares at the root every reference token, with its value", () => {
    const root = rootDeclarations();
    assert.deepEqual(Object.fromEntries(Object.keys(REFERENCE_TOKENS).map((name) => [name, root.get(name)])), REFERENCE_TOKENS);
  });

  it("declares a token for each secondary colour of the design", () => {
    const values = new Set(rootDeclarations().values());
    assert.deepEqual(
      SECONDARY_COLOURS.filter((colour) => !values.has(colour)),
      [],
    );
  });

  it("declares only custom properties at the root", () => {
    assert.deepEqual(
      [...rootDeclarations().keys()].filter((name) => !name.startsWith("--")),
      [],
    );
  });

  it("writes no colour literal outside the tokens file", () => {
    assert.deepEqual(
      sources().flatMap((file) => literalColours(read(file)).map((colour) => `${file}: ${colour}`)),
      [],
    );
  });

  it("writes no named colour outside the tokens file", async () => {
    assert.deepEqual(
      (await Promise.all(sources().map(async (file) => (await namedColours(file, read(file))).map((colour) => `${file}: ${colour}`)))).flat(),
      [],
    );
  });

  it("finds a colour written as a literal or by its name in a style sheet", async () => {
    const sheet = "a { color: #abc; background: rgb(1 2 3); border: 1px solid RebeccaPurple; outline: 2px solid currentColor } b { color: red }";
    assert.deepEqual(literalColours(sheet), ["#abc", "rgb("]);
    assert.deepEqual(await namedColours("a.css", sheet), ["RebeccaPurple", "red"]);
  });

  it("finds a named colour in a string literal of a component", async () => {
    const component = `export const Note = () => <p className="note" style={{ color: "white", background: 'Navy' }} title={\`plain\`} />;`;
    assert.deepEqual(await namedColours("note.tsx", component), ["white", "Navy"]);
  });

  it("finds a named colour in an attribute or a style element of a page", async () => {
    const page = '<meta name="theme-color" content="white" /><style>p { color: red }</style><p style=\'border-color: teal\'>red</p>';
    assert.deepEqual(await namedColours("index.html", page), ["white", "teal", "red"]);
  });

  it("finds a colour written as a literal or by its name in a drawing", async () => {
    const drawing = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red" stroke="#abc" /></svg>';
    assert.deepEqual(literalColours(drawing), ["#abc"]);
    assert.deepEqual(await namedColours("logo.svg", drawing), ["red"]);
  });

  it("scans every page, style sheet, drawing and script of the console, outside dependencies, build and tests", async () => {
    const root = await mkdtemp(join(tmpdir(), "oqas-web-"));
    try {
      for (const file of [
        "index.html",
        "README.md",
        "vite.config.mjs",
        "public/logo.svg",
        "src/a.jsx",
        "src/b.js",
        "src/c.ts",
        "src/d/e.css",
        TOKENS,
        "node_modules/x/index.js",
        "dist/a.js",
        "test/a.test.ts",
        "src/test/f.tsx",
      ]) {
        await mkdir(dirname(join(root, file)), { recursive: true });
        await writeFile(join(root, file), "");
      }
      assert.deepEqual(sources(pathToFileURL(`${root}/`)), [
        "index.html",
        "public/logo.svg",
        "src/a.jsx",
        "src/b.js",
        "src/c.ts",
        "src/d/e.css",
        "src/test/f.tsx",
        "vite.config.mjs",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
