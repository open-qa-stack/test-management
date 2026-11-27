import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import type { MemoryItem, MemoryList } from "@open-qa-stack/domain";
import { Terminal } from "../support/terminal.ts";

let terminal: Terminal;
afterEach(() => terminal.close());

describe("oqas memory", () => {
  it("gives the agents an instruction, lists it, sets it aside and rewords it, as lines or as JSON", async () => {
    terminal = await Terminal.open([]);
    assert.deepEqual(await terminal.oqas(["memory"]), { code: 0, out: "The agents keep nothing in mind yet.\n", err: "" });
    const added = await terminal.oqas(["memory", "add", "design", "shop", "Create", "customers", "by", "the", "API.", "--output", "json"]);
    const item = JSON.parse(added.out) as MemoryItem;
    assert.deepEqual(
      [item.type, item.text, item.application, item.target, item.active],
      ["instruction", "Create customers by the API.", "shop", "design", true],
    );
    const project = await terminal.oqas(["memory", "add", "all", "project", "Never", "test", "the", "risk", "report."]);
    assert.match(project.out, /^\S+ {2}active {2}instruction {2}\(project; all\) {2}Never test the risk report\.\n$/);
    assert.match(
      (await terminal.oqas(["memory", "off", item.id])).out,
      new RegExp(`^${item.id} {2}set aside {2}instruction {2}\\(shop; design\\) {2}Create customers by the API\\.\\n$`),
    );
    assert.match(
      (await terminal.oqas(["memory", "reword", item.id, "Create", "them", "by", "POST."])).out,
      /set aside {2}instruction {2}\(shop; design\) {2}Create them by POST\.\n$/,
    );
    assert.match((await terminal.oqas(["memory", "on", item.id])).out, / {2}active {2}/);
    const list = JSON.parse((await terminal.oqas(["memory", "--output", "json"])).out) as MemoryList;
    assert.deepEqual(list.counts, { active: 2, inactive: 0 });
    assert.deepEqual(await terminal.oqas(["memory", "off", "m9"]), { code: 3, out: "", err: "The instance keeps no lesson nor memory m9.\n" });
  });

  it("is refused with what it takes", async () => {
    terminal = await Terminal.open([]);
    const usage = /^oqas memory takes nothing; add then design, discovery or all/;
    for (const args of [
      ["memory", "off"],
      ["memory", "forget", "m1"],
      ["memory", "add", "design", "project"],
      ["memory", "reword", "m1"],
    ]) {
      const refused = await terminal.oqas(args);
      assert.deepEqual([refused.code, usage.test(refused.err)], [3, true], `${args.join(" ")}: ${refused.err}`);
    }
    assert.deepEqual(await terminal.oqas(["memory", "add", "diagnosis", "project", "x"]), {
      code: 3,
      out: "",
      err: "The target of a lesson is one of design, discovery, all.\n",
    });
    assert.deepEqual(await terminal.oqas(["memory", "reword", "m1", "x".repeat(601)]), {
      code: 3,
      out: "",
      err: "The text of a lesson is 1 to 600 characters: a rule the agents read as it is.\n",
    });
    assert.match(
      (await terminal.oqas(["memory", "--brief", "x"])).err,
      /oqas memory acts on the memory of the agents: it takes no --brief, --environment nor --follow\./,
    );
  });
});
