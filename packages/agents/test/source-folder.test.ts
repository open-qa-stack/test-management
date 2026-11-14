import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { ExportedElement, SourceExport } from "@open-qa-stack/tools";
import { SourceFolder } from "../src/source-workflow/source-folder.ts";

const SECRET = "postgresql://shop:s3cr3t pw@127.0.0.1:5999/shop";

const element = (name: string, definition: string): ExportedElement => ({
  name,
  kind: "table",
  summary: `table ${name}\n  columns: id bigint not null`,
  definition,
  fingerprint: "sha256:0",
  names: ["id"],
  links: [],
  file: `tables/${name}.sql`,
});

const exportOf = (...elements: ExportedElement[]): SourceExport => ({ elements, fingerprint: "sha256:1" });

let workspace: string;

before(() => {
  workspace = mkdtempSync(join(tmpdir(), "oqas-source-folder-"));
});

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const filesOf = (root: string) => readdirSync(root, { recursive: true, withFileTypes: true }).flatMap((entry) => (entry.isFile() ? [entry.name] : []));

describe("the folder of a source", () => {
  it("writes the summary of every element in one file, and the definition of each in its own", async () => {
    const folder = new SourceFolder(join(workspace, "shop-db"), []);
    await folder.writeExport(
      exportOf(element("public.orders", "CREATE TABLE public.orders (\n);"), element("public.customers", "CREATE TABLE public.customers (\n);")),
    );
    assert.equal(
      readFileSync(join(folder.root, "export", "summary.txt"), "utf8"),
      "table public.orders\n  columns: id bigint not null\n\ntable public.customers\n  columns: id bigint not null\n",
    );
    assert.equal(readFileSync(join(folder.root, "export", "tables", "public.orders.sql"), "utf8"), "CREATE TABLE public.orders (\n);\n");
    assert.deepEqual(filesOf(folder.root).sort(), ["public.customers.sql", "public.orders.sql", "summary.txt"]);
  });

  it("writes an export in place of the one before, so that no element that left the source stays", async () => {
    const folder = new SourceFolder(join(workspace, "replaced"), []);
    await folder.writeExport(
      exportOf(element("public.orders", "CREATE TABLE public.orders (\n);"), element("public.legacy", "CREATE TABLE public.legacy (\n);")),
    );
    await folder.writeExport(exportOf(element("public.orders", "CREATE TABLE public.orders (\n  id bigint\n);")));
    assert.deepEqual(filesOf(folder.root).sort(), ["public.orders.sql", "summary.txt"]);
    assert.equal(readFileSync(join(folder.root, "export", "tables", "public.orders.sql"), "utf8"), "CREATE TABLE public.orders (\n  id bigint\n);\n");
    await folder.writeExport(exportOf());
    assert.deepEqual(filesOf(folder.root), ["summary.txt"]);
  });

  it("masks the secrets of the configuration in every file, in the forms a text gives them", async () => {
    const folder = new SourceFolder(join(workspace, "masked"), [SECRET]);
    const leaking = {
      ...element("public.links", `CREATE TABLE public.links (\n  target text DEFAULT '${SECRET}'\n);`),
      summary: `table public.links\n  ${encodeURIComponent(SECRET)}`,
    };
    await folder.writeExport(exportOf(leaking));
    assert.equal(
      readFileSync(join(folder.root, "export", "tables", "public.links.sql"), "utf8"),
      "CREATE TABLE public.links (\n  target text DEFAULT '[secret]'\n);\n",
    );
    assert.equal(readFileSync(join(folder.root, "export", "summary.txt"), "utf8"), "table public.links\n  [secret]\n");
  });
});
