import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { BuiltConsole } from "./built-console.ts";

let built: BuiltConsole | undefined;

before(async () => {
  built = await BuiltConsole.start();
});

after(async () => {
  await built?.stop();
});

function app(): BuiltConsole {
  assert.ok(built, "the console is built");
  return built;
}

describe("criterion 4 — the shell switches between a tab bar and a sidebar at 960 px", () => {
  it("keeps the tab bar at the bottom and hides the sidebar at 959 px", async () => {
    const page = await app().open(959);
    try {
      assert.equal(await page.locator(".shell-sidebar").isVisible(), false);
      const tabBar = await page.locator(".shell-tab-bar").boundingBox();
      assert.ok(tabBar !== null && tabBar.height > 0);
      assert.equal(tabBar.width, 959);
      assert.equal(tabBar.y + tabBar.height, 800);
    } finally {
      await page.close();
    }
  });

  it("shows the sidebar and hides the tab bar at 960 px", async () => {
    const page = await app().open(960);
    try {
      assert.equal(await page.locator(".shell-tab-bar").isVisible(), false);
      const sidebar = await page.locator(".shell-sidebar").boundingBox();
      assert.ok(sidebar !== null && sidebar.width > 0);
      assert.equal(sidebar.x, 0);
      assert.equal(sidebar.height, 800);
    } finally {
      await page.close();
    }
  });
});

describe("criterion 5 — the code of the console is covered in full", () => {
  it("runs every line of the entry point when the console opens in the browser", async () => {
    const source = (await readFile(new URL("../src/main.tsx", import.meta.url), "utf8")).split("\n");
    const mount = source.findIndex((line) => line.startsWith("createRoot(")) + 1;
    const { lines, uncovered } = await app().measure("src/main.tsx");
    assert.ok(lines.includes(mount), `line ${mount} of src/main.tsx, the mount, is in the build`);
    assert.deepEqual(uncovered, []);
  });
});
