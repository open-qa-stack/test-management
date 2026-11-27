import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

  it("validates a test, which enters the working branch, sets another aside with why, and refuses what cannot be decided", async () => {
    terminal = await Terminal.open(chain());
    await terminal.oqas(BRIEF);
    const queue = JSON.parse((await terminal.oqas(["reviews", "--output", "json"])).out) as ReviewQueue;
    const [first, second, third] = queue.tests;
    const validated = await terminal.oqas(["reviews", "validate", first!.id]);
    assert.deepEqual(validated, { code: 0, out: `The test ${first!.id} is validated: it entered main, committed there; nothing was pushed.\n`, err: "" });
    assert.deepEqual(await terminal.oqas(["reviews", "set-aside", second!.id, "out-of-scope", "Not this time."]), {
      code: 0,
      out: `The test ${second!.id} is set aside.\n`,
      err: "",
    });
    const covered = await terminal.oqas(["reviews", "set-aside", third!.id, "covered", first!.path, "--output", "json"]);
    assert.equal((JSON.parse(covered.out) as { decision: { coveredBy: string } }).decision.coveredBy, first!.path);
    assert.deepEqual(await terminal.oqas(["reviews", "validate", second!.id]), { code: 3, out: "", err: `The test ${second!.path} is set aside already.\n` });
    const after = JSON.parse((await terminal.oqas(["reviews", "--output", "json"])).out) as ReviewQueue;
    assert.deepEqual(after.counts, { inReview: 0, setAside: 2 });
    // A test set aside goes back in review; one in review, or validated, is refused.
    assert.deepEqual(await terminal.oqas(["reviews", "restore", second!.id]), { code: 0, out: `The test ${second!.id} is back in review.\n`, err: "" });
    assert.deepEqual(JSON.parse((await terminal.oqas(["reviews", "restore", third!.id, "--output", "json"])).out), { id: third!.id, status: "in_review" });
    assert.deepEqual(await terminal.oqas(["reviews", "restore", second!.id]), { code: 3, out: "", err: `The test ${second!.path} is in review already.\n` });
    const restored = JSON.parse((await terminal.oqas(["reviews", "--output", "json"])).out) as ReviewQueue;
    assert.deepEqual(restored.counts, { inReview: 2, setAside: 0 });
  });

  it("says when the working branch had the test already as its design wrote it", async () => {
    terminal = await Terminal.open(chain());
    await terminal.oqas(BRIEF);
    const [first] = (JSON.parse((await terminal.oqas(["reviews", "--output", "json"])).out) as ReviewQueue).tests;
    const git = (...args: string[]) => execFileSync("git", args, { cwd: terminal.root, encoding: "utf8" });
    // The person took the files of the design into main by hand.
    const design = git("branch", "--show-current").trim();
    git("switch", "-q", "main");
    git("checkout", design, "--", ".");
    git("commit", "-q", "-m", "test: take the design by hand");
    assert.deepEqual(await terminal.oqas(["reviews", "validate", first!.id]), {
      code: 0,
      out: `The test ${first!.id} is validated: main had it already as its design wrote it.\n`,
      err: "",
    });
  });

  it("has the session that wrote a test correct it, runs its new turn in this command and follows it, then shows the test to review again with what was asked", async () => {
    terminal = await Terminal.open(chain());
    await terminal.oqas(BRIEF);
    const [first] = (JSON.parse((await terminal.oqas(["reviews", "--output", "json"])).out) as ReviewQueue).tests;
    const corrected = await terminal.oqas(["reviews", "correct", first!.id, "Use the order of Max."]);
    const session = /^Session (\S+)\n/.exec(corrected.err)?.[1];
    assert.ok(session !== undefined, corrected.err);
    assert.match(corrected.out, new RegExp(`^Session ${session}: `));
    // The new turn is followed from what was asked on.
    assert.match(corrected.err, /^Session \S+\n\S+ person: Fix the test \S+, "[^"]+", which a person reviewed and asks to correct\./);
    // The session ended: the test is to review again, and says what was asked.
    const shown = await terminal.oqas(["reviews", "show", first!.id]);
    assert.match(shown.out, new RegExp(`^${first!.id}  to review  `));
    assert.match(shown.out, new RegExp(`\nCorrection asked of the session ${session}: Use the order of Max\\.\n`));
    assert.deepEqual(await terminal.oqas(["reviews", "correct", "44444444-4444-4444-8444-444444444444", "x"]), {
      code: 3,
      out: "",
      err: "No test the agents wrote bears the identifier 44444444-4444-4444-8444-444444444444.\n",
    });
  });

  it("is refused with what it takes", async () => {
    terminal = await Terminal.open([]);
    const usage =
      /^oqas reviews takes nothing; show, validate or restore then the identifier of a test; correct then the identifier and what to change; or set-aside then/;
    for (const args of [
      ["reviews", "open"],
      ["reviews", "show"],
      ["reviews", "restore"],
      ["reviews", "correct", "r"],
      ["reviews", "set-aside", "r"],
      ["reviews", "set-aside", "r", "covered", "a", "b", "c"],
      ["reviews", "set-aside", "r", "out-of-scope", "a", "b"],
    ]) {
      const refused = await terminal.oqas(args);
      assert.deepEqual([refused.code, usage.test(refused.err)], [3, true], `${args.join(" ")}: ${refused.err}`);
    }
    assert.deepEqual(await terminal.oqas(["reviews", "correct", "r", "x".repeat(2001)]), {
      code: 3,
      out: "",
      err: 'A correction is { "instruction", "remember"? }: what to change in the test, 1 to 2000 characters.\n',
    });
    assert.match(
      (await terminal.oqas(["reviews", "--brief", "x"])).err,
      /oqas reviews reads the tests the agents wrote: it takes no --brief, --environment nor --follow\./,
    );
    assert.match(
      (await terminal.oqas(["reviews", "set-aside", "r", "boring"])).err,
      /The reason a test is set aside is one of covered, out_of_scope, wrong_oracle, wrong_level\./,
    );
    assert.match(
      (await terminal.oqas(["reviews", "set-aside", "r", "covered"])).err,
      /A test set aside as covered names the test that covers it, in coveredBy\./,
    );
  });
});
