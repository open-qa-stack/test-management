import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { AgentEvent, AgentRuntime } from "@open-qa-stack/domain";
import type { ExportedElement } from "@open-qa-stack/tools";
import { Journal } from "../src/common/journal.ts";
import { mapExportedSource } from "../src/source-workflow/map-exported-source.ts";
import { SourceFolder } from "../src/source-workflow/source-folder.ts";

const ORDERS = { id: "orders", label: "Orders", description: "Orders placed by customers." };

const element = (name: string): ExportedElement => ({
  name,
  kind: "table",
  summary: `table ${name}`,
  definition: `CREATE TABLE ${name} (\n);`,
  fingerprint: "sha256:0",
  names: [],
  links: [],
  file: `tables/${name}.sql`,
});

/** A model that places every element of a batch in the domain of the orders, and names every element in the file of a domain. */
const runtime: AgentRuntime = {
  openSession: async (options) => ({
    async *send(message: string): AsyncIterable<AgentEvent> {
      const names = [...message.matchAll(/^### (\S+)/gm)].map((match) => match[1]!);
      const [place] = options.tools;
      if (place === undefined) yield { type: "text", text: names.map((name) => `\`${name}\``).join(", ") };
      else await place.execute({ domains: [ORDERS], items: names.map((name) => ({ name, domain: "orders", role: "A table." })) });
      yield { type: "end", counters: { iterations: 1, actions: 0, elapsedMs: 1 } };
    },
    close: async () => undefined,
  }),
  close: async () => undefined,
};

let workspace: string;

before(() => {
  workspace = mkdtempSync(join(tmpdir(), "oqas-map-exported-"));
});

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** Maps a source of two tables into the given folder. */
async function mapped(folder: SourceFolder) {
  const journal = new Journal();
  const outcome = await mapExportedSource({
    source: { id: "shop-db", type: "postgresql" },
    exported: { elements: [element("public.orders"), element("public.order_lines")], fingerprint: "sha256:1" },
    partial: false,
    folder,
    runtime,
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
