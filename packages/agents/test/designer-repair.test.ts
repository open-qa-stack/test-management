import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import {
  BRANCH,
  DONE,
  FakeTestRunner,
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
  spec,
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
    const runner = new FakeTestRunner();
    // A first text other than the one the repository has is refused: the test runs as it is first.
    const writing = [[run(spec("list-orders"), "other")], [run(broken("list-orders").trimEnd(), "r0")], [look("l0")], ...write("list-orders")];
    const { outcome, server } = await design([...planning, ...replies(writing)], {
      root,
      runner,
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
    assert.match(told(server, "other"), /^Refused \(REPAIR-AS-IS\): the test this scenario repairs has not run as the repository has it\./);
    assert.equal(told(server, "after"), "The repair is accepted, and this session is over. Answer with one sentence; call no more tools.");
    assert.match(messages(outcome), /The tests to repair: apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts\./);
    assert.equal(specsOf(root).length, 3);
    assert.doesNotMatch(git(root, "show", `${BRANCH}:${LISTING}`), /BROKEN/);
    assert.doesNotMatch(readFileSync(join(root, LISTING), "utf8"), /BROKEN/);
    // Each run of the repaired test replaces its file, which the repository has, for the time of the run.
    assert.ok(runner.runs.length > 0);
    assert.deepEqual(new Set(runner.runs.map((test) => [test.path, test.replaces].join(" "))), new Set([`${LISTING} true`]));
    // The session that writes is told what it repairs: the file, its text now, and to run it first.
    const request = firstMessage(sessions(server).at(-1)!);
    assert.match(
      request,
      /^Repair the test of this scenario for the environment local: the repository has it in apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts/,
    );
    assert.match(request, /First call run_test with its text as it is/);
    assert.match(request, /\/\/ BROKEN/);
    // Its test is the one of the repository, not the skeleton of its plan, which may verify less.
    assert.doesNotMatch(request, /check the skeleton/);
    assert.match(request, /Next: call run_test with the text of the test as the repository has it, unchanged\.$/);
  });

  it("leaves the test as the repository has it when its repair does not pass", async () => {
    const root = await designed();
    const before = readFileSync(join(root, LISTING), "utf8");
    const planning = [{ body: toolCalls(MODEL, [repair("fix", LISTING)]) }, { body: toolCalls(MODEL, []) }];
    // The agent never runs the test as it is, and the harness closes its scenario.
    const writing = Array.from({ length: 5 }, (_, rank) => [run(spec("list-orders"), `other-${rank}`)]);
    const { outcome } = await design([...planning, ...replies([...writing, DONE])], { root, plan: false, branch: null, continued: BRANCH });
    assert.match(messages(outcome), /closed by the harness \(REPAIR-AS-IS\)/);
    assert.equal(readFileSync(join(root, LISTING), "utf8"), before);
    // What git prints ends with no blank.
    assert.equal(git(root, "show", `${BRANCH}:${LISTING}`), before.trimEnd());
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
