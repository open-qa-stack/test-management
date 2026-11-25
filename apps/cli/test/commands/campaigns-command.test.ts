import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import type { CampaignList, CampaignProgress } from "@open-qa-stack/domain";
import { chain, Terminal } from "../support/terminal.ts";

const BRIEF = ["--environment", "local", "--brief", "Test the listing of the orders."];
const FIRST = "apps/shop/tests/orders/listing/test-1.spec.ts";
const SECOND = "apps/shop/tests/orders/listing/test-2.spec.ts";

let terminal: Terminal;
afterEach(() => terminal.close());

describe("oqas campaigns", () => {
  it("plans a campaign, chooses its tests by their files, makes it ready, launches them, prints it and closes it", async () => {
    terminal = await Terminal.open(chain(), { script: { final: (file) => (file.endsWith("test-1.spec.ts") ? "unexpected" : "expected") } });
    await terminal.oqas(BRIEF);
    assert.equal((await terminal.oqas(["campaigns"])).out, "The instance keeps no campaign.\n");

    const planned = await terminal.oqas(["campaigns", "plan", "Release 1", "--environment", "local"]);
    const [id = ""] = planned.out.split(" ");
    assert.equal(planned.out, `${id}  Release 1  planned  local  0 tests\n`);
    assert.equal((await terminal.oqas(["campaigns", "choose", id, FIRST])).out, `${id}  Release 1  planned  local  1 test\n`);
    assert.equal((await terminal.oqas(["campaigns", "choose", id, FIRST, SECOND])).out, `${id}  Release 1  planned  local  2 tests\n`);
    assert.equal((await terminal.oqas(["campaigns", "ready", id])).out, `${id}  Release 1  ready  local  2 tests\n`);
    assert.deepEqual((await terminal.oqas(["campaigns", "show", id])).out.split("\n"), [
      `${id}  Release 1  ready  local  2 tests`,
      `not run ${FIRST} › test-1`,
      `not run ${SECOND} › test-2`,
      "",
    ]);
    const progress = JSON.parse((await terminal.oqas(["campaigns", "show", id, "--output", "json"])).out) as CampaignProgress;
    assert.equal(progress.results.length, 2);

    // Its tests are launched as oqas launch launches them, and the execution belongs to it.
    const launched = await terminal.oqas(["campaigns", "launch", id]);
    assert.equal(launched.code, 1);
    // The tests it finished are told as the run goes, when it is asked how far it went before it ends.
    assert.ok(launched.err.startsWith(`Tests launched against local: ${FIRST}, ${SECOND}.\n`), launched.err);
    assert.match(
      launched.out,
      new RegExp(`^\\S+ {2}campaign, campaign ${id}, on local {2}\\S+Z {2}1 of 2 tests passed, at the commit [0-9a-f]{40}\\.\\nfailed {2}${FIRST}`),
    );
    assert.equal((await terminal.oqas(["campaigns", "launch", id, "not-run"])).code, 1);
    assert.match((await terminal.oqas(["campaigns"])).out, new RegExp(`^${id} {2}Release 1 {2}in progress {2}local {2}2 tests: 2 not run\\n$`));
    assert.equal((JSON.parse((await terminal.oqas(["campaigns", "--output", "json"])).out) as CampaignList).items[0]?.status, "in_progress");

    assert.equal((await terminal.oqas(["campaigns", "close", id])).out, `${id}  Release 1  closed  local  2 tests\n`);
  });

  it("is planned with what is said of it, which its reading tells", async () => {
    terminal = await Terminal.open(chain());
    await terminal.oqas(BRIEF);
    const said = ["--objective", "Ship it", "--target", "4.2", "--from", "2026-12-01", "--until", "2026-12-05", "--owner", "QA"];
    const [id = ""] = (await terminal.oqas(["campaigns", "plan", "Release 1", "--environment", "local", ...said])).out.split(" ");
    assert.deepEqual((await terminal.oqas(["campaigns", "show", id])).out.split("\n").slice(1), [
      "objective: Ship it",
      "version: 4.2",
      "from: 2026-12-01",
      "until: 2026-12-05",
      "owner: QA",
      "",
    ]);
    const alone = await terminal.oqas(["campaigns", "show", id, "--owner", "QA"]);
    assert.deepEqual(
      [alone.code, alone.err.includes("--objective, --target, --from, --until and --owner say what a campaign is: they go with oqas campaigns plan alone.")],
      [3, true],
    );
    assert.equal((await terminal.oqas(["campaigns", "plan", "R", "--environment", "local", "--from", "soon"])).code, 3);
  });

  it("is refused with 3 for a campaign the instance does not keep, a step out of turn, a file without tests, and words it does not take", async () => {
    terminal = await Terminal.open([]);
    const refused = async (argv: readonly string[], err: string): Promise<void> =>
      assert.deepEqual(await terminal.oqas(argv), { code: 3, out: "", err: `${err}\n` });
    const [id = ""] = (await terminal.oqas(["campaigns", "plan", "Release 1", "--environment", "local"])).out.split(" ");
    await refused(["campaigns", "show", "nope"], "The instance keeps no campaign nope.");
    await refused(
      ["campaigns", "launch", id],
      "A campaign planned cannot become in_progress: a campaign goes from planned to ready, then in_progress, then closed.",
    );
    await refused(["campaigns", "choose", id, "nowhere.spec.ts"], "The test repository holds no test in nowhere.spec.ts; oqas tests lists them.");
    await refused(["campaigns", "launch", id, "everything"], "oqas campaigns launch takes failed or not-run after the campaign, or nothing for every test.");
    const takes =
      "oqas campaigns takes nothing, plan then a name, show, ready or close then a campaign, choose then a campaign and its tests, or launch then a campaign and failed or not-run.";
    for (const argv of [
      ["campaigns", "bogus", id],
      ["campaigns", "show"],
      ["campaigns", "choose", id],
      ["campaigns", "close", id, "now"],
    ])
      await refused(argv, takes);
    const environment = "oqas campaigns plan needs --environment, the environment its tests run against: it goes with plan alone.";
    await refused(["campaigns", "plan", "Release 2"], environment);
    await refused(["campaigns", "show", id, "--environment", "local"], environment);
    await refused(["campaigns", "--follow"], "oqas campaigns acts on the campaigns: it takes no --brief nor --follow.");
  });
});
