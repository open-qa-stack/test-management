import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { SourceManifest } from "@open-qa-stack/domain";
import type { ExportedElement, SourceExport } from "@open-qa-stack/tools";
import { exportManifest } from "../src/source-workflow/export-manifest.ts";
import { Grouping } from "../src/source-workflow/grouping.ts";
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

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "oqas-source-folder-"));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const AT = new Date("2026-11-13T03:00:00.000Z");
const manifestOf = (exported: SourceExport, truncated = false): SourceManifest =>
  exportManifest({ source: { id: "shop-db", type: "postgresql" }, exported, grouping: new Grouping(), files: new Map(), flawed: truncated }, AT);

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

  it("writes the manifest that lists the export: each element with its fingerprint and its file from the folder", async () => {
    const folder = new SourceFolder(join(workspace, "listed"), []);
    const exported = exportOf(element("public.orders", "CREATE TABLE public.orders (\n);"), {
      ...element("public.open_orders", "CREATE VIEW public.open_orders AS\n SELECT 1;"),
      kind: "view",
      file: "views/public.open_orders.sql",
    });
    await folder.writeExport(exported);
    await folder.writeManifest(manifestOf(exported));
    const written = readFileSync(join(folder.root, "manifest.json"), "utf8");
    assert.deepEqual(JSON.parse(written), {
      formatVersion: 1,
      source: { id: "shop-db", type: "postgresql" },
      fingerprint: "sha256:1",
      producedAt: "2026-11-13T03:00:00.000Z",
      status: "in_progress",
      domains: [],
      elements: [
        { name: "public.orders", kind: "table", fingerprint: "sha256:0", file: "export/tables/public.orders.sql" },
        { name: "public.open_orders", kind: "view", fingerprint: "sha256:0", file: "export/views/public.open_orders.sql" },
      ],
    });
    assert.ok(written.endsWith("}\n") && written.includes('\n  "status": "in_progress",\n'));
    for (const listed of manifestOf(exported).elements) assert.ok(readFileSync(join(folder.root, listed.file), "utf8").startsWith("CREATE "));
    await folder.writeManifest(manifestOf(exportOf(), true));
    assert.deepEqual(
      [
        JSON.parse(readFileSync(join(folder.root, "manifest.json"), "utf8")).status,
        JSON.parse(readFileSync(join(folder.root, "manifest.json"), "utf8")).elements,
      ],
      ["truncated", []],
    );
  });

  it("refuses a manifest that does not match its schema, and writes nothing", async () => {
    const folder = new SourceFolder(join(workspace, "refused"), []);
    const twice = manifestOf(
      exportOf(element("public.orders", "CREATE TABLE public.orders (\n);"), element("public.orders", "CREATE TABLE public.orders (\n);")),
    );
    await assert.rejects(folder.writeManifest(twice), {
      message: "The manifest of shop-db does not match its schema: /elements/1/name repeats the element public.orders.",
    });
    assert.equal(existsSync(folder.root), false);
  });

  it("masks the secrets of the configuration in the manifest", async () => {
    const folder = new SourceFolder(join(workspace, "masked-manifest"), [SECRET]);
    await folder.writeManifest(manifestOf(exportOf({ ...element("public.links", "CREATE TABLE public.links (\n);"), kind: SECRET })));
    assert.equal((JSON.parse(readFileSync(join(folder.root, "manifest.json"), "utf8")) as SourceManifest).elements[0]!.kind, "[secret]");
  });

  it("writes the file of a domain, keeps beside it the body of the model the control refused, and removes that one once a body is kept", async () => {
    const folder = new SourceFolder(join(workspace, "domains"), [SECRET]);
    assert.equal(await folder.readDomain("orders"), undefined);
    assert.equal(await folder.writeDomain("orders", "# Orders\n\n| Element |", `Read with ${SECRET}.`), "domains/orders.md");
    assert.equal(await folder.readDomain("orders"), "# Orders\n\n| Element |\n");
    assert.equal(readFileSync(join(folder.root, "domains", "orders.refused.md"), "utf8"), "Read with [secret].\n");
    await folder.writeDomain("orders", `# Orders\n\nConnect with ${SECRET}.`);
    assert.equal(await folder.readDomain("orders"), "# Orders\n\nConnect with [secret].\n");
    assert.deepEqual(filesOf(folder.root), ["orders.md"]);
  });
});
