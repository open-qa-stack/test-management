import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "vitest";
import type { PackageEntries } from "../package-table.ts";
import { ROOT } from "./demo-workspace.ts";

/** A row of a table of packages: the short name of a package, its folder, and the short names of what it depends on. */
type Row = readonly [name: string, directory: string, dependsOn: readonly string[]];

/** What a cell of the table names, between backticks. */
const named = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map(([, name]) => name!);

/** Reads the table of the package boundaries the guide of contribution shows. */
async function documented(): Promise<Row[]> {
  const guide = await readFile(join(ROOT, "CONTRIBUTING.md"), "utf8");
  const section = guide.slice(guide.indexOf("## Package boundaries"), guide.indexOf("## Commits"));
  return section
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => line.split("|").slice(1, -1))
    .map(([name, directory, dependsOn]) => [named(name!)[0]!, named(directory!)[0]!, named(dependsOn!)]);
}

/** Reads the table the lint rule applies, from the configuration of the linter. */
async function applied(): Promise<Row[]> {
  const configuration = JSON.parse(await readFile(join(ROOT, ".oxlintrc.json"), "utf8")) as {
    overrides: { rules: Record<string, [string, { packages: PackageEntries }] | undefined> }[];
  };
  const rule = configuration.overrides.map(({ rules }) => rules["open-qa-stack/package-boundaries"]).find((options) => options !== undefined)!;
  const short = (name: string): string => name.replace("@open-qa-stack/", "");
  return Object.entries(rule[1].packages).map(([name, { directory, dependsOn }]) => [short(name), directory, dependsOn.map(short)]);
}

describe("the table of the package boundaries in the guide of contribution", () => {
  it("names the packages, their folders and what each depends on as the lint rule applies them, in the same order", async () => {
    const rows = await documented();
    assert.deepEqual(rows, await applied());
    assert.equal(rows.length, 9);
  });
});
