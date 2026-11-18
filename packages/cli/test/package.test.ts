import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "vitest";

describe("the package of the command", () => {
  /** The modules the files of a folder of the sources import, with the file that imports each. */
  const importedUnder = (folder: URL, within: (file: string) => boolean): (readonly [string, string])[] =>
    readdirSync(folder, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts") && within(file))
      .flatMap((file) =>
        [...readFileSync(new URL(file, folder), "utf8").matchAll(/(?:from\s+|(?<!")\bimport\s*\(?\s*)"([^"]+)"/g)].map((match) => [file, match[1]!] as const),
      );

  const SOURCES = new URL("../src/", import.meta.url);
  const CONVERSATION = "solo/conversation/";
  const allowed = /^(node:|\.\.?\/|@open-qa-stack\/(api|engine|store|harness|tools|domain(\/sessions)?)$)/;

  it("imports the engine, the store, the harness, the tools, the domain and, to serve the console, the API, no other package, and never the SDK of the agents", () => {
    const imported = importedUnder(SOURCES, (file) => !file.startsWith(CONVERSATION)).map(([, module]) => module);
    assert.ok(imported.length > 0);
    assert.deepEqual(
      imported.filter((module) => !allowed.test(module)),
      [],
    );
    assert.ok(!imported.some((module) => module.includes("copilot")));
  });

  it("draws its conversation with Ink and React, which the files of the conversation alone import, and which are loaded for it alone", () => {
    const drawn = importedUnder(SOURCES, (file) => file.startsWith(CONVERSATION)).map(([, module]) => module);
    assert.deepEqual([...new Set(drawn.filter((module) => !allowed.test(module)))].sort(), ["ink", "ink-spinner", "ink-text-input", "react"]);
    // Nothing reaches the conversation but one import, made when it is opened: no other command loads what draws it.
    const reaching = importedUnder(SOURCES, (file) => !file.startsWith(CONVERSATION)).filter(([, module]) => module.includes("/conversation/"));
    assert.deepEqual(reaching, [["solo/solo-command.ts", "./conversation/converse.ts"]]);
    assert.match(readFileSync(new URL("solo/solo-command.ts", SOURCES), "utf8"), /await import\("\.\/conversation\/converse\.ts"\)/);
  });

  it("depends on what it imports, and on the console for its built files alone", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
    // The console is a dependency for its built files, which the command finds by the manifest of its package: none of its code is imported.
    assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
      "@open-qa-stack/api",
      "@open-qa-stack/domain",
      "@open-qa-stack/engine",
      "@open-qa-stack/harness",
      "@open-qa-stack/store",
      "@open-qa-stack/tools",
      "@open-qa-stack/web",
      "ink",
      "ink-spinner",
      "ink-text-input",
      "react",
    ]);
  });
});
