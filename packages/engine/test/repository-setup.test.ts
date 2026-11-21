import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, it } from "vitest";
import { NoConfigurationError } from "@open-qa-stack/domain";
import { configText } from "@open-qa-stack/testing/test-repository";
import { Configuration, NoRepositoryError, RepositorySetup, SETUP_COMMIT } from "../src/index.ts";
import { MemoryConfigurationStore } from "./support/memory-configuration-store.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-repository-setup-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

/** A folder that holds a configuration file, and the operation that sets it up. */
function folder(): { root: string; setup: RepositorySetup; git: (...args: string[]) => string } {
  const root = mkdtempSync(join(workspace, "repo-"));
  writeFileSync(join(root, "oqas.json"), configText("http://127.0.0.1:9/v1"));
  const setup = new RepositorySetup(root, new Configuration(new MemoryConfigurationStore(), root), "1.64.1");
  return { root, setup, git: (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }) };
}

describe("the setup of a test repository", () => {
  const global = process.env["GIT_CONFIG_GLOBAL"];
  afterEach(() => {
    if (global === undefined) delete process.env["GIT_CONFIG_GLOBAL"];
    else process.env["GIT_CONFIG_GLOBAL"] = global;
  });

  it("makes a folder that is no git repository one, writes the Playwright project and commits it with the configuration", async () => {
    const known = join(workspace, "identity.gitconfig");
    writeFileSync(known, "[user]\n\tname = Ada Tester\n\temail = ada@example.test\n");
    process.env["GIT_CONFIG_GLOBAL"] = known;
    const { root, setup, git } = folder();
    assert.deepEqual(await setup.state(), { git: "none", playwright: false });
    const done = await setup.prepare();
    assert.equal(done.committed, true);
    assert.ok(done.created.includes("playwright.config.ts"));
    assert.deepEqual(await setup.state(), { git: "ready", playwright: true });
    assert.equal(git("log", "--format=%s by %an <%ae>").trim(), `${SETUP_COMMIT} by Ada Tester <ada@example.test>`);
    assert.ok(git("show", "--name-only", "--format=").split("\n").includes("oqas.json"));
    assert.ok(existsSync(join(root, "apps")));
  });

  it("commits as Open QA Stack on a machine where git knows nobody", async () => {
    const empty = join(workspace, "no-identity.gitconfig");
    writeFileSync(empty, "");
    process.env["GIT_CONFIG_GLOBAL"] = empty;
    const { setup, git } = folder();
    await setup.prepare();
    assert.equal(git("log", "--format=%an <%ae>").trim(), "Open QA Stack <oqas@localhost>");
  });

  it("commits nothing in a git repository that exists, with or without a commit, and keeps what it holds", async () => {
    const { root, setup, git } = folder();
    git("init", "--quiet");
    assert.deepEqual(await setup.state(), { git: "empty", playwright: false });
    writeFileSync(join(root, "package.json"), '{ "name": "ours" }\n');
    const done = await setup.prepare();
    assert.deepEqual([done.committed, done.kept], [false, ["package.json"]]);
    assert.throws(() => git("rev-parse", "--verify", "--quiet", "HEAD"));
    assert.deepEqual(await setup.state(), { git: "empty", playwright: true });
  });

  it("counts a folder inside a git repository as no repository of its own", async () => {
    const { root, git } = folder();
    git("init", "--quiet");
    const inner = join(root, "inner");
    execFileSync("mkdir", [inner]);
    assert.equal((await new RepositorySetup(inner, new Configuration(new MemoryConfigurationStore(), inner)).state()).git, "none");
  });

  it("is refused to a host that was given no test repository", async () => {
    const setup = new RepositorySetup(undefined, new Configuration(new MemoryConfigurationStore(), undefined));
    await assert.rejects(
      setup.state(),
      (error) => error instanceof NoRepositoryError && error.message === "The test repository cannot be set up: the host was given no test repository.",
    );
    await assert.rejects(setup.prepare(), NoRepositoryError);
  });

  it("is refused without a configuration, and writes nothing", async () => {
    const root = mkdtempSync(join(workspace, "bare-"));
    await assert.rejects(new RepositorySetup(root, new Configuration(new MemoryConfigurationStore(), root)).prepare(), NoConfigurationError);
    assert.equal(existsSync(join(root, "playwright.config.ts")), false);
  });
});
