import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import type { ToolDefinition } from "@open-qa-stack/domain";
import type { Knowledge, SourceCodeCommands } from "@open-qa-stack/shared";
import { CodeFolder, MAX_FILE_BYTES } from "../src/source-code/code-folder.ts";
import { searchCode } from "../src/source-code/code-search.ts";
import { fileOutline, MAX_OUTLINE_SYMBOLS, type OutlineSymbol } from "../src/source-code/file-outline.ts";
import { GitHistory } from "../src/source-code/git-history.ts";
import { globMatcher, MAX_GLOB_ALTERNATIVES, MAX_GLOB_LENGTH } from "../src/source-code/glob-pattern.ts";
import { MAX_OUTPUT_LENGTH, runProcess } from "../src/source-code/process-run.ts";
import { MAX_READ_LINE_LENGTH, MAX_READ_LINES } from "../src/source-code/source-code-tools.ts";
import { parsedExtensions } from "../src/source-code/syntax-parser.ts";
import { fileLines, MAX_LINE_LENGTH } from "../src/source-code/text-search.ts";
import { knowledgeTools } from "../src/index.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/source/", import.meta.url));
const LANGUAGES = fileURLToPath(new URL("./fixtures/languages/", import.meta.url));
const GIT_IDENTITY = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com", GIT_AUTHOR_DATE: "2026-01-02T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-02T00:00:00Z" };

let workspace: string;
let repository: string;
let code: string;
let commits: { add: string; grow: string; big: string };
let git: (...args: string[]) => string;

/** A program that leaves a mark when git runs it, which it never should. */
function trap(name: string): string {
  const script = join(workspace, `${name}.sh`);
  writeFileSync(script, `#!/bin/sh\ntouch "${join(workspace, `${name}.ran`)}"\ncat\n`);
  chmodSync(script, 0o755);
  return script;
}

const ran = (name: string) => existsSync(join(workspace, `${name}.ran`));

before(() => {
  workspace = mkdtempSync(join(tmpdir(), "oqas-code-"));
  repository = join(workspace, "tests");
  code = join(workspace, "app", "service");
  mkdirSync(repository);
  cpSync(FIXTURE, code, { recursive: true });
  const files: [string, string][] = [
    ["node_modules/lib/index.js", "export const premiumOf = () => 0;"],
    ["target/Built.java", "class premiumOf {}"],
    [".cache/hidden.ts", "premiumOf"],
    ["src/long.txt", Array.from({ length: MAX_READ_LINES + 50 }, (_, i) => `line ${i + 1} ${i === 0 ? "x".repeat(MAX_READ_LINE_LENGTH + 10) : ""}`).join("\n")],
    ["data.bin", "premiumOf\0binary"],
    [":(top)", "a file with a magic name"],
  ];
  for (const [path, text] of files) {
    mkdirSync(join(code, path, ".."), { recursive: true });
    writeFileSync(join(code, path), text);
  }
  writeFileSync(join(workspace, "app", "secret.txt"), "outside the folder");
  symlinkSync(join(workspace, "app", "secret.txt"), join(code, "link.txt"));
  git = (...args: string[]) => execFileSync("git", args, { cwd: join(workspace, "app"), env: { ...process.env, ...GIT_IDENTITY }, stdio: "pipe", encoding: "utf8" }).trim();
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "Add the policy service");
  writeFileSync(join(code, "src", "growth.ts"), `${"// note\n".repeat(3000)}export const later = 1;\n`);
  git("add", "-A");
  git("commit", "-q", "-m", "Grow the policy service");
  writeFileSync(join(code, "src", "big.txt"), "y".repeat(MAX_FILE_BYTES + 200_000));
  git("add", "-A");
  git("commit", "-q", "-m", "Add a big file");
  commits = { add: git("rev-parse", "--short", "HEAD~2"), grow: git("rev-parse", "--short", "HEAD~1"), big: git("rev-parse", "--short", "HEAD") };
  writeFileSync(join(workspace, "app", "secret.txt"), "changed outside");
  git("commit", "-q", "-am", "Change a file outside the folder");
  const tree = git("rev-parse", "HEAD^{tree}");
  const signed = `tree ${tree}\nparent ${git("rev-parse", "HEAD")}\nauthor Test <test@example.com> 1767312000 +0000\ncommitter Test <test@example.com> 1767312000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n AAAA\n -----END PGP SIGNATURE-----\n\nA signed commit\n`;
  const object = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], { cwd: join(workspace, "app"), input: signed, encoding: "utf8" }).trim();
  git("update-ref", "HEAD", object);
  git("config", "log.showSignature", "true");
  git("config", "gpg.program", trap("gpg"));
  git("config", "filter.evil.clean", trap("filter"));
  git("config", "core.pager", trap("pager"));
  writeFileSync(join(workspace, "app", ".gitattributes"), "*.md filter=evil\n");
});

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function tools(commands?: SourceCodeCommands, path = "../app/service"): Map<string, ToolDefinition> {
  const source: Knowledge = { id: "policy-code", type: "source-code", path, attachments: [{ application: "policy-management" }], ...(commands === undefined ? {} : { commands }) };
  return new Map(knowledgeTools([source], { repositoryRoot: repository, env: {} }).map((t) => [t.name, t]));
}

const call = (name: string, args: object, commands?: SourceCodeCommands) => tools(commands).get(`policy_code_${name}`)!.execute(args);

describe("criterion 1 — a source code folder, possibly outside the test repository, brings tools by command level", () => {
  it("gives four reading tools, plus the git history by default, plus a shell only when declared", () => {
    const reading = ["list_files", "search", "read_file", "outline"].map((t) => `policy_code_${t}`);
    const history = ["git_log", "git_blame", "git_show"].map((t) => `policy_code_${t}`);
    assert.deepEqual([...tools("none").keys()], reading);
    assert.deepEqual([...tools().keys()], [...reading, ...history]);
    assert.deepEqual([...tools("git").keys()], [...reading, ...history]);
    assert.deepEqual([...tools("shell").keys()], [...reading, ...history, "policy_code_run_command"]);
  });

  it("says when the folder does not exist, and finds it once it does", async () => {
    const list = tools(undefined, "../later").get("policy_code_list_files")!;
    await assert.rejects(list.execute({}), /^Error: The source code folder .*later does not exist\.$/);
    mkdirSync(join(workspace, "later"));
    assert.deepEqual(await list.execute({}), { files: [], truncated: false });
  });
});

describe("criterion 2 — a search gives path, line and context, bounded, outside ignored folders; a listing follows its glob", () => {
  it("lists the files, without dependencies, builds, hidden folders or links", async () => {
    assert.deepEqual(await call("list_files", {}), {
      files: [":(top)", "README.md", "data.bin", "src/PolicyController.java", "src/big.txt", "src/growth.ts", "src/long.txt", "src/policy-service.ts"],
      truncated: false,
    });
    assert.deepEqual(await call("list_files", { glob: "*.java" }), { files: ["src/PolicyController.java"], truncated: false });
    assert.deepEqual(await call("list_files", { glob: "./src/**/*.{ts,java}", limit: 1 }), { files: ["src/PolicyController.java"], truncated: true });
    const partial = await new CodeFolder(code, 4).list();
    assert.deepEqual([partial.files.length, partial.truncated], [4, true]);
  });

  it("matches globs the way editors do, in bounded time", () => {
    const cases: [string, string, boolean][] = [
      ["*.ts", "src/a.ts", true],
      ["src/*.ts", "src/a.ts", true],
      ["src/*.ts", "src/deep/a.ts", false],
      ["src/**/*.ts", "src/deep/a.ts", true],
      ["src/**/*.ts", "src/a.ts", true],
      ["/src/**", "src/a/b", true],
      ["**", "a/b", true],
      ["a?.ts", "ab.ts", true],
      ["a?.ts", "a.ts", false],
      ["{a,b}.ts", "b.ts", true],
      ["*.{ts,{js,jsx}}", "x.jsx", true],
      ["{a.ts", "{a.ts", true],
      ["a+(b)[c].ts", "a+(b)[c].ts", true],
      ["src/a.ts", "src", false],
    ];
    for (const [glob, path, expected] of cases) assert.equal(globMatcher(glob)(path), expected, `${glob} ${path}`);
    const started = performance.now();
    assert.equal(globMatcher(`${"*a".repeat(MAX_GLOB_LENGTH / 2 - 1)}b`)("a".repeat(5000)), false);
    assert.ok(performance.now() - started < 2000);
    assert.throws(() => globMatcher("x".repeat(MAX_GLOB_LENGTH + 1)), /may not be longer than/);
    assert.throws(() => globMatcher("{a,b}".repeat(7)), new RegExp(`more than ${MAX_GLOB_ALTERNATIVES} alternatives`));
  });

  it("finds a text with the lines around it, in any case, and lists the files it could not search", async () => {
    const result = (await call("search", { pattern: "PREMIUMOF", context: 1 })) as { matches: { path: string; line: number; lines: { line: number; text: string }[] }[]; truncated: boolean; skipped: string[] };
    assert.deepEqual(result.matches.map((m) => [m.path, m.line]), [["README.md", 3], ["src/policy-service.ts", 33]]);
    assert.deepEqual(result.matches[0]!.lines, [{ line: 2, text: "" }, { line: 3, text: "The premium is computed by premiumOf." }]);
    assert.deepEqual([result.truncated, result.skipped], [false, ["data.bin", "src/big.txt"]]);
  });

  it("finds a regular expression, case-sensitive when asked, within a glob, up to the limit", async () => {
    const found = (await call("search", { pattern: "@(Get|Post)Mapping", regex: true, caseSensitive: true, glob: "*.java", context: 0, limit: 1 })) as { matches: { line: number }[]; truncated: boolean };
    assert.deepEqual([found.matches.map((m) => m.line), found.truncated], [[8], true]);
    assert.deepEqual(((await call("search", { pattern: "@getmapping", caseSensitive: true })) as { matches: unknown[] }).matches, []);
    assert.equal(((await call("search", { pattern: "Policy\\-?Repository\\b", regex: true, glob: "*.java" })) as { matches: unknown[] }).matches.length, 2);
    await assert.rejects(call("search", { pattern: "(", regex: true }), /^Error: The pattern is not a valid regular expression/);
  });

  it("cuts long lines of a search", async () => {
    const long = (await call("search", { pattern: "line 1 ", context: 0 })) as { matches: { lines: { text: string }[] }[] };
    assert.equal(long.matches[0]!.lines[0]!.text.length, MAX_LINE_LENGTH + 1);
  });

  it("stops a search that backtracks without end, and reports a file it cannot read", async () => {
    writeFileSync(join(code, "slow.txt"), `${"a".repeat(40)}!`);
    try {
      const slow = { pattern: "^(a+)+$", regex: true, caseSensitive: true, glob: "slow.txt", context: 0, limit: 1 };
      await assert.rejects(searchCode(new CodeFolder(code), slow, 200), /^Error: The search took longer than 200 ms and was stopped/);
    } finally {
      rmSync(join(code, "slow.txt"));
    }
    writeFileSync(join(code, "locked.txt"), "x");
    chmodSync(join(code, "locked.txt"), 0o000);
    try {
      await assert.rejects(call("search", { pattern: "x", glob: "locked.txt" }), /EACCES/);
    } finally {
      rmSync(join(code, "locked.txt"));
    }
  });
});

describe("criterion 3 — a read gives the lines asked for, bounded, and never leaves the folder", () => {
  it("returns numbered lines as git numbers them, a range, or the first lines within the bound", async () => {
    const all = (await call("read_file", { path: "README.md" })) as { totalLines: number; lines: { line: number; text: string }[] };
    assert.deepEqual([all.totalLines, all.lines.map((l) => l.line)], [3, [1, 2, 3]]);
    const range = (await call("read_file", { path: "src/PolicyController.java", startLine: 4, endLine: 5 })) as { lines: { line: number; text: string }[] };
    assert.deepEqual(range.lines, [{ line: 4, text: '@RequestMapping("/policies")' }, { line: 5, text: "public class PolicyController {" }]);
    const long = (await call("read_file", { path: "src/long.txt" })) as { lines: { line: number; text: string }[] };
    assert.deepEqual([long.lines.length, long.lines.at(-1)!.line, long.lines[0]!.text.length], [MAX_READ_LINES, MAX_READ_LINES, MAX_READ_LINE_LENGTH + 1]);
    assert.deepEqual([fileLines("a\r\nb\n"), fileLines(""), fileLines("a\n\n")], [["a", "b"], [""], ["a", ""]]);
  });

  it("refuses a path that leads outside the folder, through .. or a link, and what is not a readable text file", async () => {
    await assert.rejects(call("read_file", { path: "../secret.txt" }), /^Error: \.\.\/secret\.txt leads outside the folder\.$/);
    await assert.rejects(call("read_file", { path: "link.txt" }), /^Error: link\.txt leads outside the folder\.$/);
    await assert.rejects(call("read_file", { path: join(workspace, "app", "secret.txt") }), /leads outside the folder/);
    await assert.rejects(call("read_file", { path: "missing.ts" }), /^Error: missing\.ts does not exist in the folder\.$/);
    await assert.rejects(call("read_file", { path: "src" }), /^Error: src is not a file of the folder\.$/);
    await assert.rejects(call("read_file", { path: "src/big.txt" }), /is larger than/);
    await assert.rejects(call("read_file", { path: "data.bin" }), /^Error: data\.bin is a binary file\.$/);
  });
});

describe("criterion 4 — outlines of TypeScript and Java files, the git history, and no command beyond the declared level", () => {
  it("outlines a TypeScript file, class fields holding functions included, calls left out", async () => {
    assert.deepEqual(await call("outline", { path: "src/policy-service.ts" }), {
      symbols: [
        { line: 1, kind: "interface", name: "Policy" },
        { line: 5, kind: "enum", name: "PolicyKind" },
        { line: 9, kind: "type", name: "PolicyId" },
        { line: 11, kind: "class", name: "PolicyService" },
        { line: 14, kind: "method", name: "findPolicy" },
        { line: 22, kind: "method", name: "size" },
        { line: 26, kind: "method", name: "handleSubmit" },
        { line: 30, kind: "method", name: "refresh" },
        { line: 33, kind: "function", name: "premiumOf" },
        { line: 37, kind: "function", name: "renewPolicy" },
      ],
      truncated: false,
    });
  });

  it("outlines a Java file with its Spring routes", async () => {
    assert.deepEqual(await call("outline", { path: "src/PolicyController.java" }), {
      symbols: [
        { line: 4, kind: "route", name: '@RequestMapping("/policies")' },
        { line: 5, kind: "class", name: "PolicyController" },
        { line: 8, kind: "route", name: '@GetMapping(value = "/{policyId}")' },
        { line: 9, kind: "method", name: "getPolicy" },
        { line: 16, kind: "route", name: "@PostMapping" },
        { line: 17, kind: "method", name: "createPolicy" },
        { line: 23, kind: "interface", name: "PolicyRepository" },
        { line: 24, kind: "method", name: "find" },
        { line: 27, kind: "enum", name: "PolicyType" },
        { line: 29, kind: "class", name: "PolicyDto" },
      ],
      truncated: false,
    });
    assert.deepEqual(await call("outline", { path: "README.md" }), { error: "No outline for README.md: no grammar reads its language. Read the file instead." });
  });

  it("outlines C#, PHP, Python, Go, Rust, Ruby, C and C++, Bash, PowerShell and Flow files, with their routes", async () => {
    const outline = async (file: string) =>
      (await fileOutline(file, readFileSync(join(LANGUAGES, file), "utf8")))!.symbols.map((s: OutlineSymbol) => `${s.line}:${s.kind}:${s.name}`).join(" | ");
    const expected: Record<string, string> = {
      "PoliciesController.cs": "6:route:Route(\"api/[controller]\") | 7:class:PoliciesController | 11:method:PoliciesController | 13:route:HttpGet(\"{id}\") | 14:method:GetPolicy | 20:route:HttpPost(\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa… | 21:method:Create | 26:interface:IPolicyRepository | 26:method:FindAsync | 27:class:PolicyDto | 28:enum:PolicyKind | 29:class:Money",
      "PolicyController.php": "3:interface:PolicyRepository | 3:method:find | 4:class:PolicyController | 6:route:Route('/policies/{id}', methods: ['GET']) | 7:method:show | 9:function:helper",
      "Program.cs": "2:route:app.MapGet(\"/orders/{id}\", …) | 3:route:app.MapGroup(\"/api\") | 4:route:group.MapPost(\"/orders\", …) | 7:class:OrdersController | 9:route:HttpGet(\"x\") | 10:method:X",
      "base.ts": "1:route:@Controller(\"orders\") | 2:class:Base | 2:method:run",
      "broken.js": "",
      "deploy.sh": "1:function:deploy | 2:function:rollback",
      "login.js": "4:type:Props | 6:class:Login | 7:method:handleChange | 9:method:render",
      "main.go": "2:function:main | 3:route:http.HandleFunc(\"GET /orders\", …) | 5:route:r.POST(\"/orders\", …)",
      "main.rs": "1:route:get(\"/orders/{id}\") | 2:function:get_order | 3:class:Display for Order | 3:method:fmt | 4:class:Order | 4:method:new | 5:interface:Repo | 5:method:find",
      "plain.js": "1:function:plain | 3:class:Plain | 4:method:save | 5:method:run | 6:function:inner",
      "point.c": "1:class:point | 2:function:make | 4:function:ref",
      "policies.controller.ts": "1:route:@Controller(\"policies\") | 2:class:PoliciesController | 3:method:constructor | 5:route:@Get(\":id\") | 6:method:findOne | 10:method:handle | 12:interface:Policy | 13:type:PolicyId | 14:function:renew | 15:function:local",
      "policies.go": "3:class:Policy | 4:interface:Repository | 4:method:Find | 6:method:Find | 7:function:NewService | 8:type:PolicyID",
      "policies.py": "4:class:PolicyService | 5:method:find | 8:route:@app.get(\"/policies/{policy_id}\") | 9:function:get_policy",
      "policies.rb": "1:class:Policies | 2:class:PoliciesController | 3:method:show | 6:method:build",
      "policies.rs": "1:class:Policy | 2:enum:Kind | 3:interface:Repository | 3:method:find | 4:class:Repository for Store | 4:method:find | 5:function:premium",
      "policy.cpp": "1:class:PolicyStore | 3:method:count | 5:method:Store::find | 6:function:helper",
      "routes.rb": "2:route:resources(:orders) | 3:route:get('photos/:id', …)",
      "server.js": "2:route:app.get(\"/orders\", …) | 3:route:router.delete(\"/orders/:id\", …) | 5:function:module.exports.handler | 6:function:Card",
      "tools.ps1": "1:function:Get-Policy | 2:class:PolicyClient | 2:method:Fetch",
      "urls.py": "1:route:path(\"orders/\", …) | 3:function:test_x",
      "web.php": "2:route:Route::get('/orders', …) | 3:route:Route::resource('photos', …) | 4:class:C | 5:route:Route('/z') | 6:method:z",
    };
    for (const [file, symbols] of Object.entries(expected)) assert.equal(await outline(file), symbols, file);
    assert.deepEqual(await Promise.all(["notes.txt", "sh", "constructor.__proto__"].map((file) => fileOutline(file, "x"))), [undefined, undefined, undefined]);
    assert.ok(parsedExtensions().includes("cs"));
  });

  it("says when an outline is cut, keeping the first declarations, and walks deep code without exhausting the stack", async () => {
    const many = (await fileOutline("a.ts", Array.from({ length: MAX_OUTLINE_SYMBOLS + 1 }, (_, i) => `function f${i}() {}`).join("\n")))!;
    assert.deepEqual([many.symbols.length, many.truncated, many.symbols[0]!.name, many.symbols.at(-1)!.name], [MAX_OUTLINE_SYMBOLS, true, "f0", `f${MAX_OUTLINE_SYMBOLS - 1}`]);
    const deep = (await fileOutline("deep.js", `x${".a()".repeat(20_000)};\nfunction last() {}\n`))!;
    assert.deepEqual(deep.symbols, [{ line: 2, kind: "function", name: "last" }]);
  });

  it("reads the log of the folder or of a file, the blame of a few lines, and a commit", async () => {
    assert.deepEqual(await call("git_log", {}), [
      { commit: commits.big, date: "2026-01-02", author: "Test", subject: "Add a big file" },
      { commit: commits.grow, date: "2026-01-02", author: "Test", subject: "Grow the policy service" },
      { commit: commits.add, date: "2026-01-02", author: "Test", subject: "Add the policy service" },
    ]);
    assert.deepEqual(await call("git_log", { path: "README.md", limit: 1 }), [{ commit: commits.add, date: "2026-01-02", author: "Test", subject: "Add the policy service" }]);
    assert.deepEqual(await call("git_log", { path: ":(top)" }), [{ commit: commits.add, date: "2026-01-02", author: "Test", subject: "Add the policy service" }]);
    assert.equal(((await call("git_log", { path: "." })) as unknown[]).length, 3);
    assert.match((await call("git_blame", { path: "README.md", startLine: 3, endLine: 3 })) as string, /^\^?[0-9a-f]+ \(Test 2026-01-02 3\) The premium is computed by premiumOf\.\n$/);
    assert.match((await call("git_show", { commit: commits.add, path: "README.md" })) as string, /Add the policy service[\s\S]*README\.md/);
    const grown = (await call("git_show", { commit: commits.grow })) as string;
    assert.ok(grown.endsWith("\n[output cut]") && grown.length === MAX_OUTPUT_LENGTH + "\n[output cut]".length);
    assert.match((await call("git_show", { commit: commits.big })) as string, /\n\[output cut\]$/);
    assert.doesNotMatch((await call("git_show", { commit: "HEAD~1" })) as string, /secret\.txt/);
  });

  it("runs no program the repository's configuration names: no signature check, filter or pager", async () => {
    await call("git_log", {});
    await call("git_show", { commit: "HEAD" });
    await call("git_blame", { path: "README.md", startLine: 1, endLine: 1 });
    assert.deepEqual([ran("gpg"), ran("filter"), ran("pager")], [false, false, false]);
  });

  it("refuses what is not a commit, a path outside the folder, and reports git failures", async () => {
    await assert.rejects(call("git_show", { commit: "--output=/tmp/x" }), /^Error: --output=\/tmp\/x is not a commit hash nor HEAD~n\.$/);
    await assert.rejects(call("git_show", { commit: git("rev-parse", "HEAD:secret.txt") }), /^Error: git show failed: /);
    await assert.rejects(call("git_log", { path: "../secret.txt" }), /leads outside the folder/);
    await assert.rejects(call("git_show", { commit: "abcdef12" }), /^Error: git show failed: fatal: /);
    await assert.rejects(new GitHistory(new CodeFolder(code), 1).log(undefined, 1), /^Error: git log failed: it ran out of time$/);
  });

  it("runs a shell command only when the folder allows it, with PATH as its only variable", async () => {
    assert.equal(tools("git").has("policy_code_run_command"), false);
    process.env["OQAS_TEST_SECRET"] = "s3cret";
    try {
      const result = await call("run_command", { command: 'echo "[$OQAS_TEST_SECRET]" && pwd && exit 3' }, "shell");
      assert.deepEqual(result, { exitCode: 3, stdout: `[]\n${await new CodeFolder(code).rootPath()}\n`, stderr: "", timedOut: false, truncated: false });
    } finally {
      delete process.env["OQAS_TEST_SECRET"];
    }
  });

  it("stops a command that runs too long, cuts a long output, and says when a program cannot start", async () => {
    assert.deepEqual(await runProcess("/bin/sh", ["-c", "sleep 5"], code, 100), { exitCode: null, stdout: "", stderr: "", timedOut: true, truncated: false });
    const long = await runProcess("/bin/sh", ["-c", `head -c ${MAX_OUTPUT_LENGTH + 1} /dev/zero | tr '\\0' x`], code, 5000);
    assert.deepEqual([long.exitCode, long.stdout.length, long.truncated], [0, MAX_OUTPUT_LENGTH, true]);
    const flood = await runProcess("/bin/sh", ["-c", "head -c 2000000 /dev/zero | tr '\\0' x"], code, 5000);
    assert.deepEqual([flood.exitCode, flood.stdout.length, flood.truncated], [null, MAX_OUTPUT_LENGTH, true]);
    await assert.rejects(runProcess("oqas-no-such-program", [], code, 1000), /^Error: oqas-no-such-program cannot be run: ENOENT\.$/);
  });
});
