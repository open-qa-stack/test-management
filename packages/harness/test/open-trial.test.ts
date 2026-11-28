import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { OpenTrial } from "../src/runner/open-trial.ts";

const TEST = "apps/shop/tests/orders/order.spec.ts";

/** A test repository, with the mark of its trials. */
async function repository(): Promise<{ root: string; trial: OpenTrial }> {
  const root = await mkdtemp(join(tmpdir(), "open-trial-"));
  return { root, trial: new OpenTrial(root, ".oqas/trials") };
}

/** What a trial writes in the repository for the time of its run, as a process stopped meanwhile leaves it. */
async function leftBy(root: string, trial: OpenTrial, kept?: string): Promise<void> {
  await mkdir(join(root, "apps/shop/tests/orders"), { recursive: true });
  // A test that repairs one finds its references there already.
  if (kept !== undefined) {
    await writeFile(join(root, TEST), kept);
    await mkdir(join(root, `${TEST}-snapshots`));
  }
  await trial.open(TEST, kept === undefined ? undefined : Buffer.from(kept), kept !== undefined);
  await writeFile(join(root, TEST), "test under trial");
  await mkdir(join(root, `${TEST}-snapshots`), { recursive: true });
}

describe("a trial left open by a run stopped before it put its test back", () => {
  it("is put back on the next start: a new test taken out, with the references it made", async () => {
    const { root, trial } = await repository();
    await leftBy(root, trial);
    assert.equal(await trial.recover(), TEST);
    assert.deepEqual([existsSync(join(root, TEST)), existsSync(join(root, `${TEST}-snapshots`))], [false, false]);
    // Once put back, nothing is left open.
    assert.equal(await trial.recover(), undefined);
  });

  it("puts back the test a repair replaced, as the repository had it, with its references", async () => {
    const { root, trial } = await repository();
    await leftBy(root, trial, "test as committed");
    assert.equal(await trial.recover(), TEST);
    assert.equal(await readFile(join(root, TEST), "utf8"), "test as committed");
    assert.equal(existsSync(join(root, `${TEST}-snapshots`)), true, "the references it had are kept");
  });

  it("leaves the repository alone once the trial is over", async () => {
    const { root, trial } = await repository();
    await leftBy(root, trial);
    await trial.close();
    assert.equal(await trial.recover(), undefined);
    assert.equal(await readFile(join(root, TEST), "utf8"), "test under trial");
  });
});
