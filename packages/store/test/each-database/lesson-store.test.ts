import assert from "node:assert/strict";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import type { Lesson } from "@open-qa-stack/domain";
import { LessonStore } from "../../src/lessons/lesson-store.ts";
import { engineUnderTest } from "../support/database-engine.ts";
import { SessionDatabase } from "../support/session-database.ts";

let database: SessionDatabase;
let store: LessonStore;
beforeAll(async () => {
  database = await SessionDatabase.create(engineUnderTest());
  store = new LessonStore(database.database);
});
beforeEach(() => database.clear());
afterAll(() => database.drop());

const PROJECT: Lesson = { id: "l1", kind: "instruction", text: "Create customers by the API.", target: "design", active: true, at: "2026-11-27T10:00:00.000Z" };
const CORRECTION: Lesson = {
  id: "l2",
  kind: "correction",
  text: "Use the policy of Max.",
  application: "policy",
  target: "all",
  active: false,
  at: "2026-11-27T11:00:00.000Z",
  test: "t1",
};

describe("the lessons the store keeps", () => {
  it("lists them the latest first, each as it was written, and keeps one in place of the one of its identifier", async () => {
    assert.deepEqual(await store.list(), []);
    await store.add(PROJECT);
    await store.add(CORRECTION);
    assert.deepEqual(await store.list(), [CORRECTION, PROJECT]);
    const { application: _, test: __, ...moved } = { ...CORRECTION, text: "Again.", target: "discovery" as const, active: true };
    await store.set(moved);
    assert.deepEqual(await store.list(), [moved, PROJECT]);
  });
});
