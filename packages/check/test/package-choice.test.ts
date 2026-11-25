import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "vitest";
import { namedPackages, touchedLine, touchedPackages } from "../src/package-choice.ts";
import type { WorkspacePackage } from "../src/workspace-package.ts";

/** A workspace of three packages: `app` depends on `core`, `tools` on nothing, and `docs` holds no package. */
async function workspace(
  under = "",
): Promise<{ readonly root: string; readonly packages: WorkspacePackage[]; change(path: string): Promise<void>; remove(): Promise<void> }> {
  const top = await mkdtemp(join(tmpdir(), "check-choice-"));
  const root = join(top, under);
  const write = async (path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };
  await write("package.json", JSON.stringify({ name: "root" }));
  await write("README.md", "# Root\n");
  await write("packages/core/package.json", JSON.stringify({ name: "core" }));
  await write("packages/core/src/core.ts", "export const core = 1;\n");
  await write("packages/app/package.json", JSON.stringify({ name: "app", dependencies: { core: "workspace:*", left: "1.0.0" } }));
  await write("packages/app/src/app.ts", "export const app = 1;\n");
  await write("packages/tools/package.json", JSON.stringify({ name: "tools", devDependencies: { app: "workspace:*" } }));
  const git = (...args: string[]): string => execFileSync("git", args, { cwd: top, encoding: "utf8" });
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "first");
  const known = (name: string, folder: string): WorkspacePackage => ({
    name,
    path: folder === "" ? root : join(root, folder),
    testScript: undefined,
    sources: [],
    measuredInBrowser: new Set(),
    runAsProgram: new Set(),
  });
  return {
    root,
    packages: [known("root", ""), known("core", "packages/core"), known("app", "packages/app"), known("tools", "packages/tools")],
    change: (path) => write(path, `// changed ${path}\n`),
    remove: () => rm(top, { recursive: true, force: true }),
  };
}

describe("the packages a change touches", () => {
  it("are none for a change of the documents of the workspace alone", async () => {
    const demo = await workspace();
    await demo.change("README.md");
    await demo.change("docs/guide.md");
    assert.deepEqual(await touchedPackages(demo.root, demo.packages, "HEAD"), new Set());
    await demo.remove();
  });

  it("are those whose files changed, committed or not, and every package that depends on one, directly or not", async () => {
    const demo = await workspace();
    await demo.change("packages/tools/src/new.ts");
    assert.deepEqual(await touchedPackages(demo.root, demo.packages, "HEAD"), new Set(["tools"]));
    await demo.change("packages/core/src/core.ts");
    assert.deepEqual(await touchedPackages(demo.root, demo.packages, "HEAD"), new Set(["core", "app", "tools"]));
    await demo.remove();
  });

  it("are all of them for a change outside the packages that is no document, in a workspace that is a folder of its repository too", async () => {
    const demo = await workspace("product");
    await demo.change("vitest.config.ts");
    assert.equal(await touchedPackages(demo.root, demo.packages, "HEAD"), undefined);
    await demo.remove();
  });
});

describe("the packages a list names", () => {
  it("are found by their names or their folders, with the packages that depend on them, and the names that match none are given back", async () => {
    const demo = await workspace();
    assert.deepEqual(await namedPackages(demo.root, demo.packages, "packages/app,"), { chosen: new Set(["app", "tools"]) });
    assert.deepEqual(await namedPackages(demo.root, demo.packages, "core,nowhere"), { unknown: ["nowhere"] });
    await demo.remove();
  });
});

describe("the line that names the packages a change touches", () => {
  it("names them in order, or says there is none, or that every package is", () => {
    assert.equal(touchedLine("origin/main", new Set(["web", "agents"])), "check: the packages touched since origin/main: agents, web");
    assert.equal(touchedLine("origin/main", new Set()), "check: the packages touched since origin/main: none");
    assert.equal(touchedLine("origin/main", undefined), "check: the packages touched since origin/main: all of them");
  });
});
