import assert from "node:assert/strict";
import { StaleRevisionError, type OqasConfig, type RevisionEntry } from "@open-qa-stack/domain";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { ConfigurationStore } from "../../src/configuration/configuration-store.ts";
import { at } from "../support/at.ts";
import { engineUnderTest } from "../support/database-engine.ts";
import { SessionDatabase } from "../support/session-database.ts";

/** A configuration, its keys in an order of their own: the store keeps them as they were given. */
const DOCUMENT = {
  model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "test-model" },
  formatVersion: 1,
  applications: [
    { id: "shop", name: "Shop", type: "web", authentication: { method: "none" }, environments: [{ name: "local", uiUrl: "http://127.0.0.1:9/" }] },
  ],
  knowledge: [],
} as OqasConfig;

/** A revision read from a file of the given digest. */
const fromFile = (digest: string): RevisionEntry => ({ origin: "file", fileDigest: digest, document: DOCUMENT });

const engine = engineUnderTest();

let database: SessionDatabase;
let store: ConfigurationStore;
/** What the clock of the store tells, in seconds after the start of the tests. */
let now: number;
beforeAll(async () => {
  database = await SessionDatabase.create(engine);
  store = new ConfigurationStore(database.database, () => new Date(at(now)));
});
beforeEach(async () => {
  await database.clear();
  now = 0;
});
afterAll(() => database.drop());

describe("the revisions of the configuration the store keeps", () => {
  it("are none until one is recorded", async () => {
    assert.equal(await store.inForce(), undefined);
    assert.deepEqual(await store.revisions(), []);
  });

  it("are numbered from 1, each on top of the one in force, which is the last, and listed the latest first without their document", async () => {
    const first = await store.record(fromFile("a1"), 0);
    now = 60;
    const second = await store.record({ origin: "console", fileDigest: "b2", document: { ...DOCUMENT, knowledge: [] } }, 1);
    assert.deepEqual(first, { number: 1, recordedAt: at(0), origin: "file", fileDigest: "a1", document: DOCUMENT });
    assert.deepEqual(second, { number: 2, recordedAt: at(60), origin: "console", fileDigest: "b2", document: DOCUMENT });
    assert.deepEqual(await store.inForce(), second);
    assert.equal(JSON.stringify((await store.inForce())!.document), JSON.stringify(DOCUMENT));
    assert.deepEqual(await store.revisions(), [
      { number: 2, recordedAt: at(60), origin: "console", fileDigest: "b2" },
      { number: 1, recordedAt: at(0), origin: "file", fileDigest: "a1" },
    ]);
  });

  it("refuse a revision made from one another replaced since, or from one that does not exist, and keep nothing of it", async () => {
    await store.record(fromFile("a1"), 0);
    await store.record(fromFile("b2"), 1);
    const stale = (basedOn: number, inForce: number) => (error: unknown) =>
      error instanceof StaleRevisionError && error.basedOn === basedOn && error.inForce === inForce;
    await assert.rejects(store.record(fromFile("c3"), 1), stale(1, 2));
    await assert.rejects(store.record(fromFile("c3"), 0), stale(0, 2));
    await assert.rejects(store.record(fromFile("c3"), 5), stale(5, 2));
    assert.deepEqual(
      (await store.revisions()).map(({ number }) => number),
      [2, 1],
    );
  });

  it("refuse a first revision made from one that does not exist, and are dated by the clock of the machine unless told otherwise", async () => {
    await assert.rejects(store.record(fromFile("a1"), 3), (error) => error instanceof StaleRevisionError && error.inForce === 0);
    assert.deepEqual(await store.revisions(), []);
    const before = Date.now();
    const { recordedAt } = await new ConfigurationStore(database.database).record(fromFile("a1"), 0);
    assert.ok(Date.parse(recordedAt) >= before && Date.parse(recordedAt) <= Date.now(), recordedAt);
  });

  it("record one of two changes made from the same revision at once, and refuse the other", async () => {
    await store.record(fromFile("a1"), 0);
    const outcomes = await Promise.allSettled([store.record(fromFile("b2"), 1), store.record(fromFile("c3"), 1)]);
    assert.deepEqual(outcomes.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);
    assert.ok(outcomes.some((outcome) => outcome.status === "rejected" && outcome.reason instanceof StaleRevisionError));
    assert.deepEqual(
      (await store.revisions()).map(({ number }) => number),
      [2, 1],
    );
  });
});
