import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolDefinition } from "@open-qa-stack/domain";
import { SourceWatch } from "../src/designer/source-watch.ts";

/** A tool that returns what it is given to return, and counts its calls. */
function tool(name: string, results: unknown[]): ToolDefinition & { calls: number } {
  const made = {
    name,
    description: name,
    parameters: { type: "object" },
    calls: 0,
    execute: async () => {
      made.calls += 1;
      return results.shift();
    },
  };
  return made;
}

const SOURCES = [
  { id: "shop-db", type: "postgresql" as const },
  { id: "shop", type: "document" as const },
  { id: "shop-logs", type: "logs" as const },
  { id: "shop-code", type: "source-code" as const },
  { id: "empty", type: "document" as const },
];

describe("what the designer reads of the sources", () => {
  it("keeps every text and number of the results of each source, masked, and gives the results unchanged", async () => {
    const search = tool("shop_db_search", [
      { rows: [{ id: 42, name: "Mira  Veldane", token: "s3cret", flag: true, none: null, blank: " " }] },
      { error: "Unknown table." },
    ]);
    const section = tool("shop_read_section", ["# Orders\nA customer   places an order."]);
    const other = tool("notes_write", ["kept"]);
    const watch = new SourceWatch(SOURCES, [search, section, other], ["s3cret"]);
    const [watchedSearch, watchedSection, watchedOther] = watch.tools();
    assert.equal(watchedOther, other);
    assert.deepEqual(await watchedSearch!.execute({}), { rows: [{ id: 42, name: "Mira  Veldane", token: "s3cret", flag: true, none: null, blank: " " }] });
    assert.deepEqual(await watchedSearch!.execute({}), { error: "Unknown table." });
    await watchedSection!.execute({});
    assert.deepEqual(watch.last("shop-db", 5), ["42", "Mira Veldane", "[secret]"]);
    assert.deepEqual(
      [
        watch.shows("shop-db", "mira veldane"),
        watch.shows("shop-db", "s3cret"),
        watch.shows("shop-db", "places an order"),
        watch.shows(undefined, "places an order"),
        watch.shows("unknown", "42"),
      ],
      [true, false, false, true, false],
    );
    // The tools of a source that shares the start of the name of another are its own.
    assert.deepEqual(
      [watch.firstTool("shop-db"), watch.firstTool("shop"), watch.firstTool("empty"), watch.firstTool("unknown")],
      ["shop_db_search", "shop_read_section", undefined, undefined],
    );
    assert.deepEqual([watch.read("shop-db"), watch.read("shop"), watch.read("empty"), watch.read("unknown")], [true, true, false, false]);
    assert.equal(watch.last("unknown", 5).length, 0);
    // A text is dated by the result that first returned it, after the ones before.
    const [byId, byName, bySection] = [watch.shownAt("shop-db", "42"), watch.shownAt("shop-db", "mira veldane"), watch.shownAt("shop", "places an order")];
    assert.deepEqual(
      [byId === byName, byId! < bySection!, watch.shownAt("shop-db", "places an order"), watch.shownAt("unknown", "42")],
      [true, true, undefined, undefined],
    );
  });

  it("reads a failed call as nothing read, and keeps the last texts of a source within its bound", async () => {
    const failing = tool("shop_db_query", [
      { error: "Unknown column." },
      ...Array.from({ length: 25 }, (_, row) => ({ text: `row-${row}-`.padEnd(10_000, "x") })),
    ]);
    const watch = new SourceWatch(SOURCES, [failing], []);
    await watch.tools()[0]!.execute({});
    assert.equal(watch.read("shop-db"), false);
    for (let at = 0; at < 25; at += 1) await watch.tools()[0]!.execute({});
    assert.deepEqual(
      [watch.read("shop-db"), watch.shows("shop-db", "row-0-"), watch.shows("shop-db", "row-24-"), watch.last("shop-db", 100).length],
      [true, false, true, 20],
    );
    assert.deepEqual([watch.shownAt("shop-db", "row-0-"), watch.shownAt("shop-db", "row-5-")! < watch.shownAt("shop-db", "row-24-")!], [undefined, true]);
  });

  it("counts the calls of the tools of logs and of source code, as looks at what a run did, the calls of every tool, and names the first tool of each source", async () => {
    const logs = tool("shop_logs_read_logs", ["started"]);
    const code = tool("shop_code_search", [{ error: "No match." }]);
    const section = tool("shop_read_section", ["# Orders"]);
    const watch = new SourceWatch(SOURCES, [logs, code, section], []);
    for (const watched of watch.tools()) await watched.execute({});
    assert.deepEqual([watch.looks(), watch.calls(), logs.calls, code.calls, section.calls], [2, 3, 1, 1, 1]);
    assert.deepEqual(
      [watch.firstTools(), watch.firstTools("logs"), watch.firstTools("openapi")],
      [["shop_read_section", "shop_logs_read_logs", "shop_code_search"], ["shop_logs_read_logs"], []],
    );
  });
});
