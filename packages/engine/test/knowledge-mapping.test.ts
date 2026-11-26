import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { chain } from "@open-qa-stack/testing/test-repository";
import { KnowledgeMapping } from "../src/index.ts";
import { eventually } from "./support/eventually.ts";
import { Hosted } from "./support/hosted.ts";

let hosted: Hosted | undefined;
afterEach(async () => {
  await hosted?.close();
  hosted = undefined;
});

/** Where the cartography of the test repository of the host stands. */
const stateOf = (on: Hosted) => new KnowledgeMapping(on.root, on.settings, on.store).state();

/** Rewrites a JSON file of the knowledge base folder of the test repository. */
function rewrite(root: string, path: string, change: (value: Record<string, unknown>) => Record<string, unknown>): void {
  const file = join(root, ".oqas", "knowledge", path);
  writeFileSync(file, JSON.stringify(change(JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)));
}

describe("where the cartography of the knowledge stands", () => {
  it("is each source the cartography reads in the first environment, waiting, then mapping while a session maps the knowledge", async () => {
    hosted = await Hosted.create([]);
    await hosted.settings.synchronise();
    assert.deepEqual(await stateOf(hosted), { environment: "local", sources: [{ id: "order-specs", type: "document", state: "waiting" }] });
    const mapping = await hosted.store.ask({ purpose: "map" }, "another-host");
    await hosted.store.start(mapping.id, "another-host");
    assert.deepEqual((await stateOf(hosted)).sources, [{ id: "order-specs", type: "document", state: "mapping" }]);
  });

  it("is a source mapped once its card is written, in part when a limit stopped it, and the knowledge base that puts the cards together", async () => {
    hosted = await Hosted.create(chain().slice(0, 6), { host: { mapsKnowledge: true } });
    await hosted.sessions.start();
    // The host opens the session that maps the knowledge once it started.
    const session = await eventually(async () => {
      const [opened] = await hosted!.sessions.sessions();
      assert.ok(opened !== undefined);
      return opened;
    });
    await hosted.ended(session.id);
    const mapped = await stateOf(hosted);
    assert.equal(mapped.sources[0]?.state, "mapped");
    assert.match(String(mapped.sources[0]?.mappedAt), /^\d{4}-\d\d-\d\dT/);
    assert.equal(mapped.knowledgeBase?.status, "complete");
    assert.match(String(mapped.knowledgeBase?.producedAt), /^\d{4}-\d\d-\d\dT/);
    rewrite(hosted.root, "sources/order-specs.json", (card) => ({ ...card, status: "truncated" }));
    rewrite(hosted.root, "knowledge-base.json", (index) => ({ ...index, status: "truncated" }));
    const truncated = await stateOf(hosted);
    assert.deepEqual([truncated.sources[0]?.state, truncated.knowledgeBase?.status], ["truncated", "truncated"]);
    writeFileSync(join(hosted.root, ".oqas", "knowledge", "knowledge-base.json"), "not json");
    assert.equal((await stateOf(hosted)).knowledgeBase, undefined, "a knowledge base that cannot be read is none");
  });

  it("is no source for a host without a test repository, nor without a configuration", async () => {
    hosted = await Hosted.create([]);
    assert.deepEqual(await new KnowledgeMapping(undefined, hosted.settings, hosted.store).state(), { sources: [] });
    const unset = await Hosted.create([]);
    try {
      rmSync(join(unset.root, "oqas.json"));
      assert.deepEqual(await stateOf(unset), { sources: [] });
    } finally {
      await unset.close();
    }
  });
});
