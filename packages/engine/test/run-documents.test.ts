import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { MAX_DOCUMENT_BYTES, storedDocumentsPath } from "@open-qa-stack/domain";
import { DocumentSet } from "@open-qa-stack/tools";
import { chain, configText, hostOf, ran, repository, siteUrl } from "./run-support.ts";

/** The configuration of the test repository, its documents uploaded to the instance rather than kept in the repository. */
const stored = (url: string) =>
  configText(url, {
    applications: [
      {
        id: "shop",
        name: "Shop",
        type: "api",
        authentication: { method: "none" },
        environments: [{ name: "local", apis: [{ name: "backend", baseUrl: siteUrl }] }],
      },
    ],
    knowledge: [{ id: "order-specs", type: "document", stored: true, attachments: [{ application: "shop" }] }],
  });

describe("a run of a configuration whose documents the instance keeps", () => {
  it("writes them to the state folder before its cartography, in a folder of their own it empties first, where the agents read them", async () => {
    const root = repository(stored(siteUrl));
    const folder = join(root, storedDocumentsPath(".oqas", "order-specs"));
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "removed-since.md"), "# Gone\n");
    const large = `# Large\n${"a".repeat(MAX_DOCUMENT_BYTES - 8)}`;
    await hostOf(root).documents.put("order-specs", [
      { name: "orders.md", text: "# Orders\n\nA customer places an order.\n" },
      { name: "large.md", text: large },
    ]);
    // The model answers as for a source of one file: what the cartography says it left out is what it read of the folder.
    const run = await ran(chain(), {
      root: (config) => {
        writeFileSync(join(root, "oqas.json"), config!);
        return root;
      },
      config: stored,
    });
    assert.match(run.err, /order-specs: 2 documents or sections were left in no domain: large\.md, orders\.md\./);
    assert.deepEqual(
      readdirSync(folder).sort((left, right) => left.localeCompare(right)),
      ["large.md", "orders.md"],
    );
    assert.equal(readFileSync(join(folder, "orders.md"), "utf8"), "# Orders\n\nA customer places an order.\n");
    assert.equal(await new DocumentSet(root, storedDocumentsPath(".oqas", "order-specs")).read("large.md"), large);
  });
});
