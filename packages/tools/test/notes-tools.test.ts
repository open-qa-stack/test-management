import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { ToolDefinition } from "@open-qa-stack/domain";
import { Notebook, notesTools } from "../src/index.ts";

let folder: string;
before(() => {
  folder = mkdtempSync(join(tmpdir(), "oqas-notes-"));
});
after(() => {
  rmSync(folder, { recursive: true, force: true });
});

const SECRET = "p@ss word";

function tools(path: string, task = "t1"): Map<string, ToolDefinition> {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 10, 13, 4, 0, tick++));
  return new Map(notesTools(new Notebook(path), { role: "cartographer", task, secrets: [SECRET, ""], now }).map((tool) => [tool.name, tool]));
}

describe("criterion 1 — a note is found by one of its tags and by a word of its text, the best first, bounded", () => {
  it("ranks by tags in common, then by words, the latest first on a tie", async () => {
    const path = join(folder, "memory", "notes.jsonl");
    const notes = tools(path);
    const remember = notes.get("remember")!;
    assert.equal(await remember.execute({ text: "The demo customer has one health policy.", tags: ["Policies", "demo"], source: "policy-db" }), "Kept.");
    await remember.execute({ text: "Quote requests go through the self-service backend.", tags: ["quotes"] });
    await remember.execute({ text: "Policies are listed on the My Policies screen.", tags: ["policies", "screens"] });
    const recall = notes.get("recall")!;
    const byTag = (await recall.execute({ tags: ["policies"] })) as { text: string; tags: string[] }[];
    assert.deepEqual(byTag.map((n) => n.text), ["Policies are listed on the My Policies screen.", "The demo customer has one health policy."]);
    assert.deepEqual(byTag[1]!.tags, ["policies", "demo"]);
    const byWord = (await recall.execute({ text: "backend quote" })) as { text: string; score: number }[];
    assert.deepEqual(byWord.map((n) => [n.text, n.score]), [["Quote requests go through the self-service backend.", 2]]);
    assert.equal(((await recall.execute({ limit: 1 })) as unknown[]).length, 1);
    assert.deepEqual(((await recall.execute({ source: "policy-db" })) as { source: string }[]).map((n) => n.source), ["policy-db"]);
    assert.deepEqual(await recall.execute({ tags: ["nothing"] }), []);
  });
});

describe("criterion 2 — a note that holds a secret is refused", () => {
  it("refuses the secret as it is or encoded in an address", async () => {
    const notes = tools(join(folder, "secret.jsonl"));
    const remember = notes.get("remember")!;
    for (const text of [`The password is ${SECRET}.`, `Sign in at /login?p=${encodeURIComponent(SECRET)}`]) {
      assert.deepEqual(await remember.execute({ text, tags: ["accounts"] }), { error: "The note holds a secret of the configuration; it was not kept. Write it without the secret." });
    }
    assert.deepEqual(await notes.get("recall")!.execute({}), []);
  });
});

describe("criterion 3 — notes outlive the session and are found by another task", () => {
  it("reads the notes another task wrote, skipping lines that are not notes", async () => {
    const path = join(folder, "shared.jsonl");
    await tools(path, "first").get("remember")!.execute({ text: "Customers are created through the API.", tags: ["customers"] });
    appendFileSync(path, "not json\n{\"text\": 3}\n");
    const found = (await tools(path, "second").get("recall")!.execute({ tags: ["customers"] })) as { text: string; role: string }[];
    assert.deepEqual(found.map((n) => [n.text, n.role]), [["Customers are created through the API.", "cartographer"]]);
  });

  it("fails a search on a notebook it cannot read", async () => {
    const path = join(folder, "a-folder");
    mkdirSync(path);
    await assert.rejects(new Notebook(path).find({ limit: 1 }), /EISDIR/);
  });

  it("dates a note with the system clock by default", async () => {
    const path = join(folder, "clock.jsonl");
    const [remember] = notesTools(new Notebook(path), { role: "designer", task: "t", secrets: [] });
    await remember!.execute({ text: "A fact.", tags: ["x"] });
    const [found] = await new Notebook(path).find({ limit: 1 });
    assert.ok(Date.parse(found!.writtenAt) > Date.UTC(2026, 0, 1));
  });
});
