import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import {
  BRANCH,
  DONE,
  MODEL,
  broken,
  design,
  firstMessage,
  git,
  look,
  messages,
  replies,
  run,
  sessions,
  specsOf,
  told,
  valid,
  write,
  type Call,
} from "./designer-support.ts";
import { toolCalls } from "@open-qa-stack/testing";

/** The test of the first scenario, as the first design writes it. */
const LISTING = "apps/shop/tests/orders/listing/list-orders.spec.ts";

/** The test of the last scenario, as the first design writes it. */
const GONE = "apps/shop/tests/orders/listing/follow-order.spec.ts";

/** A call that asks for the repair of tests. */
const repair = (id: string, ...paths: string[]): Call => ({ id, name: "repair_tests", arguments: { paths } });

/** A test repository whose tests a design wrote, the first of them broken since, as by a change of the application. */
async function designed(): Promise<string> {
  const { outcome, root } = await design(replies(valid(3)));
  assert.equal(outcome.ok, true, messages(outcome));
  writeFileSync(join(root, LISTING), broken("list-orders"));
  git(root, "commit", "-q", "-am", "test: break the listing");
  return root;
}

describe("a design that repairs tests the repository has", () => {
  it("writes the test again in its own file, from the scenario of the plan that wrote it, and commits it on the branch", async () => {
    const root = await designed();
    const after = { id: "after", name: "tests_list", arguments: {} };
    const planning = [{ body: toolCalls(MODEL, [repair("fix", LISTING)]) }, { body: toolCalls(MODEL, [after]) }, { body: toolCalls(MODEL, []) }];
    const { outcome, server } = await design([...planning, ...replies([[run(broken("list-orders"), "r0")], [look("l0")], ...write("list-orders")])], {
      root,
      plan: false,
      branch: null,
      continued: BRANCH,
      brief: "Fix the failing test list-orders.spec.ts.",
    });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.equal(outcome.repaired, true);
    assert.deepEqual(
      outcome.tests.map((test) => test.path),
      [LISTING],
    );
    // Once the repair is asked, the session that plans is over.
    assert.equal(told(server, "after"), "The repair is accepted, and this session is over. Answer with one sentence; call no more tools.");
    assert.match(messages(outcome), /The tests to repair: apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts\./);
    assert.equal(specsOf(root).length, 3);
    assert.doesNotMatch(git(root, "show", `${BRANCH}:${LISTING}`), /BROKEN/);
    assert.doesNotMatch(readFileSync(join(root, LISTING), "utf8"), /BROKEN/);
    // The session that writes is told what it repairs: the file, its text now, and to run it first.
    const writing = sessions(server).at(-1)!;
    const request = firstMessage(writing);
    assert.match(
      request,
      /^Repair the test of this scenario for the environment local: the repository has it in apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts/,
    );
    assert.match(request, /First call run_test with its text as it is/);
    assert.match(request, /\/\/ BROKEN/);
  });

  it("refuses a path that is no test and a test no plan records, with what to do", async () => {
    const root = await designed();
    writeFileSync(join(root, "apps", "shop", "tests", "orders", "listing", "by-hand.spec.ts"), broken("by hand"));
    // A test a design wrote whose file is gone since is no test to repair.
    git(root, "rm", "-q", GONE);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "test: add a test by hand");
    const calls = [[repair("unknown", GONE, "apps/shop/tests/orders/listing/by-hand.spec.ts")], DONE];
    const { outcome, server } = await design(replies(calls), { root, plan: false, branch: null, continued: BRANCH });
    assert.equal(outcome.ok, false);
    assert.equal(
      told(server, "unknown"),
      [
        `Refused (REPAIR-UNKNOWN): the repository has no test at ${GONE}. Call tests_list for the paths of its tests.`,
        "Refused (REPAIR-UNPLANNED): no plan records the scenario of apps/shop/tests/orders/listing/by-hand.spec.ts, which was not written by a design. Leave it out, or plan a scenario for what it verifies with propose_plan instead.",
        "Nothing else was refused.",
      ].join("\n"),
    );
  });
});
