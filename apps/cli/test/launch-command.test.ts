import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import type { Execution } from "@open-qa-stack/domain";
import type { CommandIo } from "../src/solo/command-io.ts";
import { chain, Terminal, type Setup } from "./support/terminal.ts";

const BRIEF = ["--environment", "local", "--brief", "Test the listing of the orders."];
const LOCAL = ["--environment", "local"];
const FIRST = "apps/shop/tests/orders/listing/test-1.spec.ts";
const SECOND = "apps/shop/tests/orders/listing/test-2.spec.ts";

let terminal: Terminal;
afterEach(() => terminal.close());

/** A terminal whose design wrote the three tests of the chain, the tests running as the setup scripts them at the end. */
async function designed(setup: Setup = {}): Promise<Terminal> {
  terminal = await Terminal.open(chain(), setup);
  await terminal.oqas(BRIEF);
  return terminal;
}

/** The runner of the terminal, which holds the run of the tests once they finished, until the test lets it through. */
function holding(through: Promise<void>): NonNullable<CommandIo["runner"]> {
  return {
    run: async (step) => {
      const outcome = await terminal.runner.run(step);
      if (step.env?.["OQAS_PROGRESS_FILE"] !== undefined) await through;
      return outcome;
    },
  };
}

describe("oqas launch", () => {
  it("runs the tests of the files named in this process, tells each one it finished while the run goes on, then its execution", async () => {
    await designed();
    let through = (): void => undefined;
    const held = new Promise<void>((resolve) => (through = resolve));
    const ran = await terminal.oqas(["launch", FIRST, SECOND, ...LOCAL], {
      io: { runner: holding(held) },
      heard: (text) => {
        if (text.startsWith(`passed  ${SECOND}`)) through();
      },
    });
    assert.equal(ran.code, 0);
    assert.equal(ran.err, `Tests launched against local: ${FIRST}, ${SECOND}.\npassed  ${FIRST} › the test\npassed  ${SECOND} › the test\n`);
    assert.match(ran.out, new RegExp(`^\\S+ {2}manual {2}\\S+Z {2}2 of 2 tests passed, at the commit [0-9a-f]{40}\\.\\npassed {2}${FIRST} › the test\\n`));
    const executions = await terminal.oqas(["executions", "--output", "json"]);
    assert.deepEqual(
      (JSON.parse(executions.out) as { items: Execution[] }).items.map(({ origin }) => origin),
      ["manual", "design"],
    );
  });

  it("exits with 1 when a test failed, with 2 when one was skipped and none failed, as a session does", async () => {
    await designed({
      script: { final: (file) => (file.endsWith("test-1.spec.ts") ? "unexpected" : file.endsWith("test-2.spec.ts") ? "skipped" : "expected") },
    });
    assert.equal((await terminal.oqas(["launch", FIRST, SECOND, ...LOCAL])).code, 1);
    const skipped = await terminal.oqas(["launch", SECOND, ...LOCAL, "--output", "json"]);
    assert.equal(skipped.code, 2);
    assert.deepEqual(
      (JSON.parse(skipped.out) as Execution).results.map(({ verdict }) => verdict),
      ["skipped"],
    );
  });

  it("exits with 5 and says why when the run kept no execution, the runner having written no report", async () => {
    await designed();
    const silent: NonNullable<CommandIo["runner"]> = {
      run: (step) => (step.env?.["OQAS_PROGRESS_FILE"] === undefined ? terminal.runner.run(step) : Promise.resolve({ exitCode: 1, stdout: "", stderr: "" })),
    };
    const ran = await terminal.oqas(["launch", ...LOCAL], { io: { runner: silent } });
    assert.equal(ran.code, 5);
    assert.match(
      ran.err,
      /^Tests launched against local: every test of the repository\.\n[\s\S]*\nThe tests ran, but no execution of them is kept: The runner wrote no report\.\n$/,
    );
  });

  it("is refused with 3 without an environment among several, with one not declared, and with what opens a session", async () => {
    terminal = await Terminal.open([]);
    const refused = async (argv: readonly string[], err: string): Promise<void> =>
      assert.deepEqual(await terminal.oqas(argv), { code: 3, out: "", err: `${err}\n` });
    await refused(["launch"], "Several environments are declared (local, staging): name the one the tests run against.");
    await refused(["launch", "--environment", "nowhere"], "The environment nowhere is not declared: the configuration declares local, staging.");
    await refused(["launch", "--brief", "Orders."], "oqas launch runs tests as they are: it takes --environment, and no --brief nor --follow.");
  });
});
