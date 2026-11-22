import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, it } from "vitest";
import { resolvedConfig, type OqasConfig } from "@open-qa-stack/domain";
import { chain, configText, markMapped } from "@open-qa-stack/testing/test-repository";
import { unmappedEnvironment } from "../src/knowledge/unmapped.ts";
import { eventually } from "./support/eventually.ts";
import { Hosted } from "./support/hosted.ts";

/** The replies of the model for the cartography of the test repository alone: the check of the server, the card, the index. */
const MAPPING = () => chain().slice(0, 6);

let hosted: Hosted | undefined;
afterEach(async () => {
  await hosted?.close();
  hosted = undefined;
});

describe("a host that maps the knowledge", () => {
  it("maps what waits for it once it started, in a session no person asked, which writes no test, then opens none while nothing waits", async () => {
    hosted = await Hosted.create(MAPPING(), { host: { mapsKnowledge: true } });
    await hosted.sessions.start();
    const [asked] = await eventually(async () => {
      const sessions = await hosted!.sessions.sessions();
      assert.equal(sessions.length, 1);
      return sessions;
    });
    assert.deepEqual([asked!.purpose, asked!.request, asked!.environment], ["map", undefined, "local"]);
    const session = await hosted.ended(asked!.id);
    assert.deepEqual([session.state, session.result?.outcome, session.result?.tests], ["completed", "passed", []]);
    assert.equal(session.result?.branch, undefined);
    assert.ok(existsSync(join(hosted.root, ".oqas", "index", "domain-index.json")));
    assert.equal(hosted.server.requests.length, 6, "the model maps, and designs nothing");
    const events = await hosted.events(asked!.id);
    assert.ok(!events.some((event) => event.type === "user_message"), "no person asked it");
    // A revision that adds nothing to map opens no session.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await hosted.sessions.sessions()).length, 1);
  });

  it("maps a source as soon as the revision that adds it is recorded, unless a mapping waits already", async () => {
    hosted = await Hosted.create([], { host: { mapsKnowledge: true } });
    markMapped(hosted.root);
    await hosted.sessions.start();
    assert.deepEqual(await hosted.sessions.sessions(), []);
    // Another host asked for a mapping, which waits for it.
    const waiting = await hosted.store.ask({ purpose: "map" }, "another-host");
    const inForce = await hosted.settings.synchronise();
    const added = { id: "guides", type: "document", path: "specs", attachments: [{ application: "shop" }] } as const;
    const document = { ...inForce.document, knowledge: [...inForce.document.knowledge, added] };
    const second = await hosted.settings.save(document, inForce.number);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(
      (await hosted.store.sessions()).map(({ id }) => id),
      [waiting.id],
      "the mapping that waits maps the source added",
    );
    await hosted.store.interrupt(waiting.id);
    await hosted.settings.save({ ...document, knowledge: [...document.knowledge, { ...added, id: "more-guides" }] }, second.number);
    const mapping = await eventually(async () => {
      const [latest] = await hosted!.store.sessions();
      assert.notEqual(latest?.id, waiting.id);
      return latest!;
    });
    assert.equal(mapping.purpose, "map");
  });

  it("maps nothing while the instance has no configuration", async () => {
    hosted = await Hosted.create([], { host: { mapsKnowledge: true } });
    rmSync(join(hosted.root, "oqas.json"));
    await hosted.sessions.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(await hosted.store.sessions(), []);
  });

  it("tells what kept it from mapping, and nothing once it stops", async () => {
    hosted = await Hosted.create([], { host: { mapsKnowledge: true } });
    await hosted.sessions.start();
    await eventually(async () => assert.equal((await hosted!.store.sessions()).length, 1));
    hosted.store.before = (command) => {
      if (command === "sessions") throw new Error("The store does not answer.");
    };
    rmSync(join(hosted.root, ".oqas", "index"), { recursive: true, force: true });
    const inForce = await hosted.settings.synchronise();
    await hosted.settings.save({ ...inForce.document, language: "fr" }, inForce.number);
    await eventually(() =>
      assert.ok(hosted!.logger.lines.includes("warn The knowledge is not mapped: The store does not answer."), hosted!.logger.lines.join("\n")),
    );
    const before = hosted.logger.lines.length;
    const stopping = hosted.sessions.stop(10_000);
    await hosted.settings.save({ ...inForce.document, language: "en" }, inForce.number + 1);
    await stopping;
    assert.equal(hosted.logger.lines.slice(before).filter((line) => line.includes("not mapped")).length, 0);
  });
});

describe("the knowledge that waits to be mapped", () => {
  const root = mkdtempSync(join(tmpdir(), "oqas-unmapped-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const config = (changes: Record<string, unknown> = {}) => resolvedConfig(JSON.parse(configText("http://127.0.0.1:9/v1", changes)) as OqasConfig);

  it("is a source without a card, or cards no index puts together, in the first environment", async () => {
    writeFileSync(join(root, "oqas.json"), configText("http://127.0.0.1:9/v1"));
    assert.equal(await unmappedEnvironment(config(), root), "local");
    markMapped(root);
    assert.equal(await unmappedEnvironment(config(), root), undefined);
    rmSync(join(root, ".oqas", "index", "domain-index.json"));
    assert.equal(await unmappedEnvironment(config(), root), "local");
  });

  it("is nothing when the cartography reads no source", async () => {
    const bare = config({ knowledge: [] });
    const without = {
      ...bare,
      applications: bare.applications.map((application) => ({
        ...application,
        environments: application.environments.map(({ uiUrl: _, ...environment }) => environment),
      })),
    };
    mkdirSync(join(root, "empty"), { recursive: true });
    assert.equal(await unmappedEnvironment(without as typeof bare, join(root, "empty")), undefined);
  });
});
