import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { themeOf } from "../../src/solo/conversation/palette.ts";
import { IDENTITIES } from "../../src/solo/conversation/speakers.ts";

const UTF8 = { LANG: "en_US.UTF-8", TERM: "xterm-256color" };

describe("the theme of the conversation", () => {
  it("gives each tone its colour, the harness the colour of the text, and what is muted dimmed", () => {
    const { ink } = themeOf(UTF8);
    assert.deepEqual([ink("accent"), ink("ko"), ink("harness"), ink("muted")], [{ color: "cyan" }, { color: "red" }, {}, { dimColor: true }]);
  });

  it("draws without colour when NO_COLOR is set to anything, or the terminal is dumb: dimming stays, which is no colour", () => {
    for (const env of [
      { ...UTF8, NO_COLOR: "1" },
      { ...UTF8, NO_COLOR: "true" },
      { LANG: "en_US.UTF-8", TERM: "dumb" },
    ]) {
      const { ink } = themeOf(env);
      assert.deepEqual([ink("accent"), ink("ko"), ink("muted")], [{}, {}, { dimColor: true }], JSON.stringify(env));
    }
    assert.deepEqual(themeOf({ ...UTF8, NO_COLOR: "" }).ink("ok"), { color: "green" });
  });

  it("draws its glyphs when the locale names UTF-8, read from LC_ALL, then LC_CTYPE, then LANG", () => {
    for (const env of [UTF8, { LC_ALL: "fr_FR.utf8" }, { LC_ALL: "", LC_CTYPE: "en_GB.UTF-8", LANG: "C" }]) {
      const theme = themeOf(env);
      assert.deepEqual([theme.unicode, theme.glyphs.rule, theme.glyphs.passed, theme.glyphs.spinner], [true, "─", "✓", "dots"], JSON.stringify(env));
    }
  });

  it("falls back on ASCII when the locale does not, or the terminal is dumb or the console of Linux", () => {
    for (const env of [{}, { LANG: "C" }, { LC_ALL: "POSIX", LANG: "en_US.UTF-8" }, { ...UTF8, TERM: "linux" }, { ...UTF8, TERM: "dumb" }]) {
      const theme = themeOf(env);
      assert.deepEqual([theme.unicode, theme.glyphs.rule, theme.glyphs.passed, theme.glyphs.spinner], [false, "-", "+", "line"], JSON.stringify(env));
      assert.ok(Object.values(theme.glyphs).every((glyph) => /^[\x20-\x7e]+$/.test(glyph)));
    }
  });
});

describe("the speakers of the conversation", () => {
  it("each have a name and a mark of their own, in both sets of glyphs, so that none is told by its colour alone", () => {
    const identities = Object.values(IDENTITIES);
    for (const read of [({ name }: { name: string }) => name, ({ mark }: { mark: string }) => mark, ({ ascii }: { ascii: string }) => ascii])
      assert.equal(new Set(identities.map(read)).size, identities.length);
    assert.ok(identities.every(({ ascii }) => /^[\x21-\x7e]$/.test(ascii)));
  });
});
