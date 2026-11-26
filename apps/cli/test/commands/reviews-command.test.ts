import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import type { ReviewQueue, TestProposal } from "@open-qa-stack/domain";
import { chain, Terminal } from "../support/terminal.ts";

const BRIEF = ["--environment", "local", "--brief", "Test the listing of the orders."];

let terminal: Terminal;
afterEach(() => terminal.close());

describe("oqas reviews", () => {
  it("lists the tests a session wrote for a person to review, and tells what is read to decide of one, as lines or as JSON", async () => {
    terminal = await Terminal.open(chain());
    assert.deepEqual(await terminal.oqas(["reviews"]), { code: 0, out: "No test the agents wrote waits for a review.\n", err: "" });
    await terminal.oqas(BRIEF);
    const listed = await terminal.oqas(["reviews"]);
    assert.equal(listed.code, 0, listed.err);
    assert.match(listed.out, /^[0-9a-f-]{36} {2}to review {2}The test-1 scenario {2}\(shop › orders, functional; passed after 1 run; not reviewed\)\n/);
    const queue = JSON.parse((await terminal.oqas(["reviews", "--output", "json"])).out) as ReviewQueue;
    assert.deepEqual(
      [queue.counts, queue.tests.map(({ title }) => title)],
      [{ inReview: 3, setAside: 0 }, ["The test-1 scenario", "The test-2 scenario", "The test-3 scenario"]],
    );
    const [first] = queue.tests;
    const shown = await terminal.oqas(["reviews", "show", first!.id]);
    assert.equal(shown.code, 0, shown.err);
    assert.match(
      shown.out,
      /\napps\/shop\/tests\/orders\/listing\/test-1\.spec\.ts, on oqas\/design-\d{8}T\d{6}Z\nAsked: Test the listing of the orders\.\nWhy: /,
    );
    assert.match(shown.out, /\n1\. Get the orders\n {3}expects: The orders answer\n/);
    assert.match(shown.out, /\nFiles: apps\/shop\/tests\/orders\/listing\/test-1\.spec\.ts \(\+\d+\), apps\/shared\/fixtures\.ts \(\+\d+\)\n$/);
    const proposal = JSON.parse((await terminal.oqas(["reviews", "show", first!.id, "--output", "json"])).out) as TestProposal;
    assert.equal(proposal.id, first!.id);
    assert.deepEqual(await terminal.oqas(["reviews", "show", "nobody"]), {
      code: 3,
      out: "",
      err: "No test the agents wrote bears the identifier nobody.\n",
    });
  });

  it("is refused with what it takes", async () => {
    terminal = await Terminal.open([]);
    for (const args of [
      ["reviews", "open"],
      ["reviews", "show"],
      ["reviews", "--brief", "x"],
    ]) {
      const refused = await terminal.oqas(args);
      assert.equal(refused.code, 3, args.join(" "));
      assert.match(
        refused.err,
        /oqas reviews (takes nothing, or show then the identifier of a test|reads the tests the agents wrote: it takes no --brief, --environment nor --follow)\./,
      );
    }
  });
});
