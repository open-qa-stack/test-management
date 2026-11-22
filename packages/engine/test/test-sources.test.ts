import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { TestChangeRefusedError, UnknownTestError, type OqasConfig } from "@open-qa-stack/domain";
import { NoRepositoryError, RepositoryTests, TestSources } from "../src/index.ts";
import { MemoryConfigurationStore } from "./support/memory-configuration-store.ts";
import { MemoryTestStore } from "./support/memory-test-store.ts";

/** A configuration whose applications are in the folder `apps`. */
const DOCUMENT = {
  formatVersion: 1,
  applications: [{ id: "shop", name: "Shop", type: "api", authentication: { method: "none" }, environments: [{ name: "local" }] }],
  model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "test-model" },
} as OqasConfig;

const PATH = "apps/shop/orders.spec.ts";
const ID = "3f0c2b9e-8d4a-4f1e-9b7a-2c5d6e7f8a90";

/** A test of the orders, as a person wrote it: no identifier yet. */
const FILE = 'test("Search an order", async () => {\n  await test.step("1. Open the orders", async () => {});\n});\n';

/** Runs git in a repository, and gives what it printed. */
const git = (root: string, ...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" });

/**
 * The operations on the source of the tests of a git repository that holds the test of the orders, committed on the
 * branch `main` with an identity of its own, and what they keep.
 */
async function sources(configured = true) {
  const root = mkdtempSync(join(tmpdir(), "oqas-test-sources-"));
  mkdirSync(join(root, "apps", "shop"), { recursive: true });
  writeFileSync(join(root, PATH), FILE);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Tester");
  git(root, "config", "user.email", "tester@example.com");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "test: add the orders");
  const configuration = new MemoryConfigurationStore();
  if (configured) await configuration.record({ origin: "file", fileDigest: "a1", document: DOCUMENT }, 0);
  const identities = new MemoryTestStore();
  const tests = new RepositoryTests(root, configuration, identities);
  return { root, identities, sources: new TestSources({ repository: root, configuration, tests, identities, newId: () => ID }) };
}

describe("the source of the tests of the repository", () => {
  it("reads the file of a test as it is now", async () => {
    const { sources: read } = await sources();
    assert.deepEqual(await read.read(PATH), { path: PATH, content: FILE });
  });

  it("is refused for a file the tests are not listed from, before a configuration is in force, or without a repository", async () => {
    const { sources: read, root } = await sources();
    writeFileSync(join(root, "notes.spec.ts"), FILE);
    for (const path of ["notes.spec.ts", "apps/shop/missing.spec.ts", "../outside.spec.ts"]) await assert.rejects(read.read(path), UnknownTestError, path);
    await assert.rejects((await sources(false)).sources.read(PATH), UnknownTestError);
    const configuration = new MemoryConfigurationStore();
    const none = new TestSources({
      repository: undefined,
      configuration,
      tests: new RepositoryTests(undefined, configuration, new MemoryTestStore()),
      identities: new MemoryTestStore(),
    });
    await assert.rejects(none.read(PATH), NoRepositoryError);
  });

  it("changes a test in its file, gives it its identifier the first time, and keeps it where it was before", async () => {
    const { sources: changed, root, identities } = await sources();
    const renamed = await changed.change({ path: PATH, title: "Search an order", change: { title: "Find an order" } });
    assert.deepEqual([renamed.title, renamed.id, renamed.steps], ["Find an order", ID, ["1. Open the orders"]]);
    assert.equal(readFileSync(join(root, PATH), "utf8"), FILE.replace('test("Search an order", ', `test("Find an order", { tag: "@oqas-id-${ID}" }, `));
    assert.deepEqual(identities.told[0], [{ id: ID, path: PATH, title: "Find an order", was: { path: PATH, title: "Search an order" } }]);
    const stepped = await changed.change({ path: PATH, title: "Find an order", change: { step: 1, text: "Open the list of orders" } });
    assert.deepEqual([stepped.steps, stepped.id], [["1. Open the list of orders"], ID]);
  });

  it("commits the file alone on the branch checked out, and leaves what else is changed or staged as it is", async () => {
    const { sources: changed, root } = await sources();
    writeFileSync(join(root, "notes.md"), "staged\n");
    git(root, "add", "notes.md");
    writeFileSync(join(root, "draft.md"), "untracked\n");
    await changed.change({ path: PATH, title: "Search an order", change: { title: "Find an order" } });
    await changed.change({ path: PATH, title: "Find an order", change: { step: 1, text: "Open the list of orders" } });
    assert.deepEqual(git(root, "log", "--format=%s %an", "-3").trim().split("\n"), [
      'test: reword step 1 of "Find an order" Tester',
      'test: rename "Search an order" to "Find an order" Tester',
      "test: add the orders Tester",
    ]);
    assert.deepEqual(git(root, "show", "--name-only", "--format=", "HEAD").trim(), PATH);
    assert.deepEqual(git(root, "status", "--porcelain").trim().split("\n"), ["A  notes.md", "?? draft.md"]);
  });

  it("is refused before anything is written when the file cannot be committed alone, with what to do first", async () => {
    const rename = { path: PATH, title: "Search an order", change: { title: "Find an order" } } as const;
    const refusedWith = async (prepare: (root: string) => void, reason: RegExp) => {
      const { sources: changed, root } = await sources();
      prepare(root);
      const before = readFileSync(join(root, PATH), "utf8");
      await assert.rejects(changed.change(rename), (error: Error) => error instanceof TestChangeRefusedError && reason.test(error.message));
      assert.equal(readFileSync(join(root, PATH), "utf8"), before);
    };
    await refusedWith((root) => writeFileSync(join(root, PATH), `${FILE}// mine\n`), /has changes that are not committed: commit them or drop them first\.$/);
    await refusedWith((root) => git(root, "checkout", "-q", "--detach"), /^No branch is checked out/);
    await refusedWith(
      (root) => writeFileSync(join(root, ".git", "MERGE_HEAD"), git(root, "rev-parse", "HEAD")),
      /^A merge, a rebase, a cherry-pick or a revert is under way/,
    );
    await refusedWith((root) => execFileSync("rm", ["-rf", join(root, ".git")]), /is not the root of a git repository with a commit: make it one first\.$/);
  });

  it("puts the file back as it was when git refuses the commit, and says why", async () => {
    for (const [hook, said] of [
      ["echo 'the hook says no' >&2; exit 1", /^git refused to commit apps\/shop\/orders\.spec\.ts, which is left as it was: the hook says no$/],
      ["exit 1", /^git refused to commit apps\/shop\/orders\.spec\.ts, which is left as it was: Error: Command failed: git commit/],
    ] as const) {
      const { sources: changed, root, identities } = await sources();
      writeFileSync(join(root, ".git", "hooks", "pre-commit"), `#!/bin/sh\n${hook}\n`);
      chmodSync(join(root, ".git", "hooks", "pre-commit"), 0o755);
      await assert.rejects(
        changed.change({ path: PATH, title: "Search an order", change: { title: "Find an order" } }),
        (error: Error) => error instanceof TestChangeRefusedError && said.test(error.message),
      );
      assert.deepEqual([readFileSync(join(root, PATH), "utf8"), git(root, "status", "--porcelain"), identities.told], [FILE, "", []]);
    }
  });

  it("is refused for a test the file does not declare, or a change that cannot be written", async () => {
    const { sources: changed } = await sources();
    await assert.rejects(changed.change({ path: PATH, title: "Close an order", change: { title: "B" } }), UnknownTestError);
    await assert.rejects(changed.change({ path: PATH, title: "Search an order", change: { step: 2, text: "Close" } }), TestChangeRefusedError);
  });

  it("gives a random identifier by default", async () => {
    const { root } = await sources();
    const configuration = new MemoryConfigurationStore();
    await configuration.record({ origin: "file", fileDigest: "a1", document: DOCUMENT }, 0);
    const identities = new MemoryTestStore();
    const changed = await new TestSources({ repository: root, configuration, tests: new RepositoryTests(root, configuration, identities), identities }).change({
      path: PATH,
      title: "Search an order",
      change: { title: "Find an order" },
    });
    assert.match(changed.id!, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
