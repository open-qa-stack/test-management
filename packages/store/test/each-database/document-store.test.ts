import assert from "node:assert/strict";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { DocumentStore } from "../../src/documents/document-store.ts";
import { at } from "../support/at.ts";
import { engineUnderTest } from "../support/database-engine.ts";
import { SessionDatabase } from "../support/session-database.ts";

const engine = engineUnderTest();

let database: SessionDatabase;
let store: DocumentStore;
/** What the clock of the store tells, in seconds after the start of the tests. */
let now: number;
beforeAll(async () => {
  database = await SessionDatabase.create(engine);
  store = new DocumentStore(database.database, () => new Date(at(now)));
});
beforeEach(async () => {
  await database.clear();
  now = 0;
});
afterAll(() => database.drop());

describe("the documents of the knowledge sources the store keeps", () => {
  it("are none until some are uploaded", async () => {
    assert.deepEqual(await store.list("specs"), []);
    assert.deepEqual(await store.documents("specs"), []);
    assert.equal(await store.read("specs", "quotes.md"), undefined);
  });

  it("are kept under their source, sized in bytes of UTF-8, dated, and listed by their names code unit by code unit", async () => {
    await store.put("specs", [
      { name: "quotes.md", text: "# Devis\n" },
      { name: "Claims.md", text: "# Sinistres é\n" },
      { name: "a.md", text: "" },
    ]);
    await store.put("notes", [{ name: "other.md", text: "# Other\n" }]);
    assert.deepEqual(await store.list("specs"), [
      { name: "Claims.md", bytes: 15, uploadedAt: at(0) },
      { name: "a.md", bytes: 0, uploadedAt: at(0) },
      { name: "quotes.md", bytes: 8, uploadedAt: at(0) },
    ]);
    assert.deepEqual(
      (await store.documents("specs")).map(({ name, text }) => [name, text]),
      [
        ["Claims.md", "# Sinistres é\n"],
        ["a.md", ""],
        ["quotes.md", "# Devis\n"],
      ],
    );
    assert.deepEqual(await store.read("notes", "other.md"), { name: "other.md", bytes: 8, uploadedAt: at(0), text: "# Other\n" });
    assert.equal(await store.read("notes", "quotes.md"), undefined);
  });

  it("replace the document of their name in their source", async () => {
    await store.put("specs", [{ name: "quotes.md", text: "# One\n" }]);
    now = 60;
    await store.put("specs", [{ name: "quotes.md", text: "# Two, longer\n" }]);
    assert.deepEqual(await store.read("specs", "quotes.md"), { name: "quotes.md", bytes: 14, uploadedAt: at(60), text: "# Two, longer\n" });
    assert.equal((await store.list("specs")).length, 1);
  });

  it("are kept all of an upload or none", async () => {
    await store.put("specs", [{ name: "quotes.md", text: "# One\n" }]);
    // A name given twice within an upload breaks no rule of the table, but a text the database refuses fails it whole.
    await assert.rejects(
      store.put("specs", [
        { name: "claims.md", text: "# Claims\n" },
        { name: "quotes.md", text: null as unknown as string },
      ]),
    );
    assert.deepEqual(
      (await store.list("specs")).map(({ name }) => name),
      ["quotes.md"],
    );
  });

  it("are removed one at a time, which tells whether the source held it", async () => {
    await store.put("specs", [
      { name: "quotes.md", text: "#" },
      { name: "claims.md", text: "#" },
    ]);
    await store.put("notes", [{ name: "quotes.md", text: "#" }]);
    assert.equal(await store.remove("specs", "quotes.md"), true);
    assert.equal(await store.remove("specs", "quotes.md"), false);
    assert.deepEqual(
      (await store.list("specs")).map(({ name }) => name),
      ["claims.md"],
    );
    assert.equal((await store.list("notes")).length, 1);
  });

  it("are dated by the clock of the machine unless the store is given another", async () => {
    const before = Date.now();
    await new DocumentStore(database.database).put("specs", [{ name: "quotes.md", text: "#" }]);
    const [document] = await store.list("specs");
    assert.ok(Date.parse(document!.uploadedAt) >= before - 1);
  });
});
