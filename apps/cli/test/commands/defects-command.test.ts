import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import type { DefectList } from "@open-qa-stack/domain";
import { Terminal } from "../support/terminal.ts";

let terminal: Terminal;
afterEach(() => terminal.close());

const PATH = "apps/shop/tests/orders/listing/list-orders.spec.ts";

describe("oqas defects", () => {
  it("reports a defect of a test, lists it, and moves it, as lines or as JSON", async () => {
    terminal = await Terminal.open([]);
    assert.deepEqual(await terminal.oqas(["defects"]), { code: 0, out: "No defect was reported yet.\n", err: "" });
    const reported = await terminal.oqas(["defects", "report", PATH, "The orders are listed", "S2", "The total is wrong", "It shows 0."]);
    assert.equal(reported.code, 0, reported.err);
    assert.match(
      reported.out,
      new RegExp(`^D-1 {2}S2 {2}open {2}The total is wrong {2}\\(The orders are listed, ${PATH.replaceAll(".", "\\.")}; reported \\S+\\)\\n$`),
    );
    assert.match((await terminal.oqas(["defects", "fix", "D-1"])).out, /^D-1 {2}S2 {2}fixed, to run again {2}/);
    assert.match((await terminal.oqas(["defects", "close", "D-1"])).out, /^D-1 {2}S2 {2}closed {2}/);
    assert.deepEqual(await terminal.oqas(["defects", "fix", "D-1"]), { code: 3, out: "", err: "The defect D-1 is closed: from there it can be open.\n" });
    assert.match((await terminal.oqas(["defects", "open", "D-1"])).out, /^D-1 {2}S2 {2}open {2}/);
    const list = JSON.parse((await terminal.oqas(["defects", "--output", "json"])).out) as DefectList;
    assert.deepEqual([list.items.map(({ id }) => id), list.counts], [["D-1"], { open: 1, toReplay: 0, closed: 0 }]);
    assert.deepEqual(await terminal.oqas(["defects", "fix", "D-9"]), { code: 3, out: "", err: "The instance keeps no defect D-9.\n" });
  });

  it("is refused with what it takes", async () => {
    terminal = await Terminal.open([]);
    const usage = /^oqas defects takes nothing; report then the path of a test, its title, a severity from S1 to S4/;
    for (const args of [
      ["defects", "fix"],
      ["defects", "solve", "D-1"],
      ["defects", "report", PATH, "Title", "S2"],
    ]) {
      const refused = await terminal.oqas(args);
      assert.deepEqual([refused.code, usage.test(refused.err)], [3, true], `${args.join(" ")}: ${refused.err}`);
    }
    assert.match((await terminal.oqas(["defects", "report", PATH, "Title", "S9", "Total"])).err, /The severity of a defect is one of S1, S2, S3, S4\./);
    assert.match(
      (await terminal.oqas(["defects", "--brief", "x"])).err,
      /oqas defects acts on the defects of the instance: it takes no --brief, --environment nor --follow\./,
    );
  });
});
