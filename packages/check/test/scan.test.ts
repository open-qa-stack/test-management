import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { commitMessageFindings } from "../src/commit-message-scan.ts";
import { GitRepository } from "../src/git-repository.ts";
import { ScanCommand } from "../src/scan-command.ts";
import { SecretsStep } from "../src/secrets-step.ts";
import { inRepository, type DemoRepository } from "./demo-repository.ts";

/** The entry point of the scan. */
const MAIN = fileURLToPath(new URL("../src/scan-main.ts", import.meta.url));

/** A demonstration private key in the PEM format, put together at run time so that no file of this repository holds one. */
const PRIVATE_KEY = [
  ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" "),
  "MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu",
  ["-----END", "RSA PRIVATE KEY-----"].join(" "),
].join("\n");

/** A demonstration token in the format of a GitHub token, put together at run time for the same reason. */
const GITHUB_TOKEN = ["ghp", "A1b2C3d4".repeat(4) + "E5f6"].join("_");

/** What a run of the scan gave. */
interface ScanRun {
  readonly code: number;
  readonly lines: readonly string[];
}

/**
 * @param repository - The repository to scan.
 * @param args - The arguments of the scan.
 * @returns What the scan gave.
 */
async function scan(repository: DemoRepository, ...args: string[]): Promise<ScanRun> {
  const lines: string[] = [];
  const code = await new ScanCommand(new GitRepository(repository.root), (line) => lines.push(line)).run(args);
  return { code, lines };
}

describe("the commit message rules", () => {
  it("accept a Conventional Commits subject of 72 bytes at most, with or without a scope", () => {
    assert.deepEqual(commitMessageFindings("feat(check): scan the commits\n\nA body.\n"), []);
    assert.deepEqual(commitMessageFindings(`fix!: ${"a".repeat(66)}`), []);
  });

  it("refuse any other subject, naming it, and a longer one, counted in bytes", () => {
    assert.deepEqual(commitMessageFindings("Merge branch 'topic'"), ["subject does not follow Conventional Commits: Merge branch 'topic'"]);
    assert.deepEqual(commitMessageFindings(`docs: ${"a".repeat(67)}`), ["subject longer than 72 bytes"]);
    assert.deepEqual(commitMessageFindings(`docs: ${"\u00e9".repeat(2)}${"a".repeat(64)}`), ["subject longer than 72 bytes"]);
  });

  it("criterion 4 — refuse each attribution trailer, whatever its case", () => {
    const message = ["feat: add a file", "", "Co-Authored-By: Someone <someone@example.com>", "co-authored-by: x", "GENERATED-BY: y", "generated-by: z"].join(
      "\n",
    );
    assert.deepEqual(commitMessageFindings(message), [
      'attribution trailer "Co-Authored-By"',
      'attribution trailer "co-authored-by"',
      'attribution trailer "GENERATED-BY"',
      'attribution trailer "generated-by"',
    ]);
  });
});

describe("the scan", { concurrency: true }, () => {
  it("criterion 5 — refuses a staged file that holds a private key in the PEM format, naming the file and the rule but not the key", async () => {
    await inRepository(async (repository) => {
      await repository.stage({ "config/deploy key.pem": `${PRIVATE_KEY}\n` });
      const run = await scan(repository);
      assert.equal(run.code, 1);
      assert.deepEqual(run.lines, ['config/deploy key.pem: secret found by the rule "private-key"', "scan: 1 finding(s)"]);
    });
  });

  it("criterion 5 — refuses a staged file that holds a token in the format of a GitHub token, naming the file and the rule but not the token", async () => {
    await inRepository(async (repository) => {
      await repository.stage({ "src/client.ts": `export const token = "${GITHUB_TOKEN}";\n` });
      const run = await scan(repository);
      assert.equal(run.code, 1);
      assert.deepEqual(run.lines, ['src/client.ts: secret found by the rule "github-token"', "scan: 1 finding(s)"]);
      assert.doesNotMatch(run.lines.join("\n"), new RegExp(GITHUB_TOKEN));
    });
  });

  it("criterion 6 — fails on the history of a branch one commit of which has a Co-Authored-By trailer, naming the commit", async () => {
    await inRepository(async (repository) => {
      repository.git("switch", "-q", "-c", "topic");
      await repository.commit({ "a.txt": "a\n" }, "feat: add a");
      const credited = await repository.commit({ "b.txt": "b\n" }, "feat: add b\n\nCo-Authored-By: Someone <someone@example.com>");
      const run = await scan(repository, "main..topic");
      assert.equal(run.code, 1);
      assert.deepEqual(run.lines, [`commit ${credited}: attribution trailer "Co-Authored-By"`, "scan: 1 finding(s)"]);
    });
  });

  it("criterion 10 — accepts a history of compliant commits, with a compliant merge", async () => {
    await inRepository(async (repository) => {
      repository.git("switch", "-q", "-c", "topic");
      await repository.commit({ "src/sign.ts": "export const sign = (value: number): number => Math.sign(value);\n" }, "feat(sign): give the sign of a number");
      repository.git("switch", "-q", "main");
      repository.git("merge", "-q", "--no-ff", "-m", "feat(sign): give the sign of a number", "topic");
      const run = await scan(repository, "--all");
      assert.equal(run.code, 0, run.lines.join("\n"));
      assert.deepEqual(run.lines, ["scan: nothing found"]);
    });
  });

  it("names the merge whose message is the default one of git", async () => {
    await inRepository(async (repository) => {
      repository.git("switch", "-q", "-c", "topic");
      await repository.commit({ "a.txt": "a\n" }, "feat: add a");
      repository.git("switch", "-q", "main");
      await repository.commit({ "b.txt": "b\n" }, "feat: add b");
      repository.git("merge", "-q", "--no-edit", "topic");
      const merge = repository.git("rev-parse", "HEAD");
      const run = await scan(repository, "HEAD");
      assert.deepEqual(run.lines, [`commit ${merge}: subject does not follow Conventional Commits: Merge branch 'topic'`, "scan: 1 finding(s)"]);
    });
  });

  it("finds a secret that a commit added and a later one removed, in the added lines only", async () => {
    await inRepository(async (repository) => {
      const added = await repository.commit({ "notes.txt": `++ ${GITHUB_TOKEN}\n`, "other.txt": `${PRIVATE_KEY}\n` }, "docs: add notes");
      repository.git("rm", "-q", "other.txt");
      await repository.commit({ "notes.txt": "nothing\n" }, "docs: clear the notes");
      assert.deepEqual((await scan(repository)).lines, ["scan: nothing found"]);
      const run = await scan(repository, "--all");
      assert.equal(run.code, 1);
      assert.deepEqual(run.lines, [
        `commit ${added}: notes.txt: secret found by the rule "github-token"`,
        `commit ${added}: other.txt: secret found by the rule "private-key"`,
        "scan: 2 finding(s)",
      ]);
    });
  });

  it("finds a secret that the author of a merge added, naming the merge, and not the lines the merged commits added", async () => {
    await inRepository(async (repository) => {
      repository.git("switch", "-q", "-c", "topic");
      await repository.commit({ "a.txt": "topic\n" }, "feat: write a from a topic");
      repository.git("switch", "-q", "main");
      await repository.commit({ "a.txt": "main\n" }, "feat: write a from main");
      assert.throws(() => repository.git("merge", "-q", "topic"), /Command failed/);
      await repository.stage({ "a.txt": `${GITHUB_TOKEN}\n` });
      repository.git("commit", "-q", "-m", "feat: write a from both");
      const merge = repository.git("rev-parse", "HEAD");
      await repository.commit({ "a.txt": "both\n" }, "fix: remove a token");
      const run = await scan(repository, "--all");
      assert.deepEqual(run.lines, [`commit ${merge}: a.txt: secret found by the rule "github-token"`, "scan: 1 finding(s)"]);
    });
  });

  it("refuses options other than --all alone, and a revision it cannot find, without scanning", async () => {
    await inRepository(async (repository) => {
      for (const args of [["--output=x"], ["--all", "main"]])
        assert.deepEqual(await scan(repository, ...args), { code: 2, lines: ["usage: pnpm scan [--all | <revision range>...]"] });
      const run = await scan(repository, "missing..main");
      assert.equal(run.code, 2);
      assert.match(run.lines.join("\n"), /^scan: .*missing/);
    });
  });

  it("runs as a command in the folder it is started from", async () => {
    await inRepository(async (repository) => {
      const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", MAIN, "HEAD"], { cwd: repository.root, encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, "scan: nothing found\n");
    });
  });

  it("is a step of the check, which refuses a staged secret", async () => {
    await inRepository(async (repository) => {
      assert.deepEqual(await new SecretsStep(repository.root).run(), []);
      await repository.stage({ "token.txt": GITHUB_TOKEN });
      assert.deepEqual(await new SecretsStep(repository.root).run(), ['token.txt: secret found by the rule "github-token"']);
    });
  });
});

describe("a git repository", () => {
  it("fails on a command that git cannot start", async () => {
    await assert.rejects(new GitRepository("/nonexistent-folder").read(["status"]), { code: "ENOENT" });
  });
});
