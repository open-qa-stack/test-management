import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { AgentEvent, AgentRuntime } from "@open-qa-stack/domain";
import type { ExportedElement } from "@open-qa-stack/tools";
import { Journal } from "../src/common/journal.ts";
import { mapExportedSource } from "../src/source-workflow/map-exported-source.ts";
import { SourceFolder } from "../src/source-workflow/source-folder.ts";

const ORDERS = { id: "orders", label: "Orders", description: "Orders placed by customers." };

const LINES = { id: "lines", label: "Lines", description: "The lines of an order." };

const element = (name: string, fingerprint = "sha256:0"): ExportedElement => ({
  name,
  kind: "table",
  summary: `table ${name}`,
  definition: `CREATE TABLE ${name} (\n);`,
  fingerprint,
  names: [],
  links: [],
  file: `tables/${name}.sql`,
});

/** A model that places every element of a batch in the domain chosen for it, the orders by default, and names every element in the file of a domain. */
const placing = (domainOf: (name: string) => typeof ORDERS = () => ORDERS, asked: string[] = []): AgentRuntime => ({
  openSession: async (options) => ({
    async *send(message: string): AsyncIterable<AgentEvent> {
      asked.push(message);
      const names = [...message.matchAll(/^### (\S+)/gm)].map((match) => match[1]!);
      const [place] = options.tools;
      if (place === undefined) yield { type: "text", text: names.map((name) => `\`${name}\``).join(", ") };
      else await place.execute({ domains: [ORDERS, LINES], items: names.map((name) => ({ name, domain: domainOf(name).id, role: "A table." })) });
      yield { type: "end", counters: { iterations: 1, actions: 0, elapsedMs: 1 } };
    },
    close: async () => undefined,
  }),
  close: async () => undefined,
});
const runtime = placing();
const TWO = [element("public.orders"), element("public.order_lines")];

let workspace: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "oqas-map-exported-"));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** Maps a source, of two tables by default, into the given folder. */
async function mapped(folder: SourceFolder, elements: readonly ExportedElement[] = TWO, model: AgentRuntime = runtime, force = false) {
  const journal = new Journal();
  const outcome = await mapExportedSource({
    source: { id: "shop-db", type: "postgresql" },
    exported: { elements, fingerprint: "sha256:1" },
    partial: false,
    notes: [],
    force,
    folder,
    runtime: model,
    limits: { maxIterations: 5, maxDurationMs: null, maxActions: null },
    secrets: [],
    journal,
    sent: () => undefined,
    received: () => undefined,
    now: () => new Date("2026-11-13T03:00:00.000Z"),
  });
  return { outcome, journal: journal.entries().map((entry) => `${entry.level}: ${entry.message}`) };
}

describe("the workflow of a source that has an export", () => {
  it("ends complete once every element is in a domain whose file, read back from the disk, names it", async () => {
    const { outcome, journal } = await mapped(new SourceFolder(join(workspace, "whole"), []));
    assert.deepEqual(
      [outcome.manifest.status, outcome.manifest.domains, outcome.usage.requests],
      ["complete", [{ ...ORDERS, file: "domains/orders.md", writtenBy: "model" }], 2],
    );
    assert.equal(journal.at(-1), "info: The mapping of shop-db is complete: 1 domains, 2 elements placed, 0 set aside, 0 unplaced.");
  });

  it("ends truncated when the last control finds, on the disk, a file that does not name an element of its domain", async () => {
    /** A folder whose domain files cannot be read back. */
    class UnreadableFolder extends SourceFolder {
      /** {@inheritDoc SourceFolder.readDomain} */
      public override readDomain(): Promise<string | undefined> {
        return Promise.resolve(undefined);
      }
    }
    const { outcome, journal } = await mapped(new UnreadableFolder(join(workspace, "unreadable"), []));
    assert.equal(outcome.manifest.status, "truncated");
    assert.deepEqual(journal.slice(-3), [
      "error: The last control of shop-db failed: public.orders is not named in the file of its domain orders.",
      "error: The last control of shop-db failed: public.order_lines is not named in the file of its domain orders.",
      "error: The mapping of shop-db is truncated: 1 domains, 2 elements placed, 0 set aside, 0 unplaced.",
    ]);
  });
});

describe("the workflow of a source an earlier run mapped", () => {
  const infos = (journal: readonly string[]) => journal.filter((line) => line.startsWith("info: ")).map((line) => line.slice("info: ".length));

  it("asks nothing of the model when no element changed, and keeps the files", async () => {
    const folder = new SourceFolder(join(workspace, "unchanged"), []);
    await mapped(folder);
    const { outcome, journal } = await mapped(folder);
    assert.deepEqual([outcome.manifest.status, outcome.usage.requests], ["complete", 0]);
    assert.deepEqual(infos(journal).slice(1, 3), [
      "2 of the 2 elements of shop-db did not change; they keep their place.",
      "The file of the domain orders is up to date; it was kept.",
    ]);
  });

  it("places again only an element that changed, told where it was, and writes again the file of its domain", async () => {
    const folder = new SourceFolder(join(workspace, "changed"), []);
    await mapped(folder);
    const asked: string[] = [];
    const { outcome } = await mapped(folder, [TWO[0]!, element("public.order_lines", "sha256:changed")], placing(undefined, asked));
    assert.deepEqual([outcome.manifest.status, outcome.usage.requests], ["complete", 2]);
    assert.ok(asked[0]!.includes("### public.order_lines\ntable public.order_lines\nIt changed since it was placed in orders."));
    assert.ok(!asked[0]!.includes("### public.orders\n"));
    // The file names both elements again, though one alone was placed.
    assert.ok(asked[1]!.includes("### public.orders ") && asked[1]!.includes("### public.order_lines "));
  });

  it("places a new element, forgets one that left the source, and writes again the file of a domain that gained or lost one", async () => {
    const folder = new SourceFolder(join(workspace, "moved"), []);
    await mapped(folder);
    const gained = await mapped(folder, [...TWO, element("public.invoices")]);
    assert.deepEqual(
      [gained.outcome.usage.requests, gained.outcome.manifest.elements.map((kept) => kept.name).sort()],
      [2, ["public.invoices", "public.order_lines", "public.orders"]],
    );
    const lost = await mapped(folder, [TWO[0]!]);
    // Nothing is to place: the file alone is written again, without the element that left.
    assert.deepEqual([lost.outcome.usage.requests, lost.outcome.manifest.elements.map((kept) => kept.name)], [1, ["public.orders"]]);
  });

  it("removes the file of a domain left without any element", async () => {
    const folder = new SourceFolder(join(workspace, "emptied"), []);
    await mapped(
      folder,
      TWO,
      placing((name) => (name === "public.order_lines" ? LINES : ORDERS)),
    );
    assert.ok(existsSync(join(folder.root, "domains", "lines.md")));
    const { outcome, journal } = await mapped(folder, [TWO[0]!, element("public.order_lines", "sha256:changed")]);
    assert.deepEqual(
      outcome.manifest.domains.map((domain) => domain.id),
      ["orders"],
    );
    assert.ok(!existsSync(join(folder.root, "domains", "lines.md")));
    assert.ok(infos(journal).includes("The domain lines holds no element any more; its file was removed."));
  });

  it("writes again a file the harness wrote itself, and one that no longer names an element of its domain", async () => {
    const folder = new SourceFolder(join(workspace, "rewritten"), []);
    await mapped(folder);
    writeFileSync(join(folder.root, "domains", "orders.md"), "# Orders\n\nNothing named.\n");
    const again = await mapped(folder);
    assert.deepEqual([again.outcome.manifest.status, again.outcome.usage.requests], ["complete", 1]);
    /** A model whose file of a domain is never accepted, so that the harness writes it. */
    const silent: AgentRuntime = {
      openSession: async (options) => ({
        async *send(message: string): AsyncIterable<AgentEvent> {
          if (options.tools.length > 0) yield* (await placing().openSession(options)).send(message);
          else yield { type: "end", counters: { iterations: 1, actions: 0, elapsedMs: 1 } };
        },
        close: async () => undefined,
      }),
      close: async () => undefined,
    };
    const fallback = new SourceFolder(join(workspace, "fallback"), []);
    const first = await mapped(fallback, TWO, silent);
    assert.equal(first.outcome.manifest.domains[0]!.writtenBy, "harness");
    const retried = await mapped(fallback);
    assert.deepEqual([retried.outcome.manifest.domains[0]!.writtenBy, retried.outcome.usage.requests], ["model", 1]);
  });

  it("maps everything again when told to, and when the manifest left cannot be read", async () => {
    const folder = new SourceFolder(join(workspace, "forced"), []);
    await mapped(folder);
    assert.equal((await mapped(folder, TWO, runtime, true)).outcome.usage.requests, 2);
    writeFileSync(join(folder.root, "manifest.json"), "{ not json");
    assert.equal((await mapped(folder)).outcome.usage.requests, 2);
    writeFileSync(join(folder.root, "manifest.json"), JSON.stringify({ formatVersion: 99 }));
    assert.equal((await mapped(folder)).outcome.usage.requests, 2);
  });
});
