import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { parseArguments, soloCommand } from "../src/index.ts";
import { RepositoryInit } from "../src/solo/repository-init.ts";

const workspace = mkdtempSync(join(tmpdir(), "repository-init-"));
after(() => rmSync(workspace, { recursive: true, force: true }));

/** A configuration of two applications, one of which signs in with an account whose variables are set nowhere. */
const CONFIG = {
  formatVersion: 1,
  applications: [
    { id: "shop", name: "Shop", type: "web", authentication: { method: "none" }, environments: [{ name: "local", uiUrl: "http://127.0.0.1:3000" }] },
    {
      id: "back-office",
      name: "Back Office",
      type: "web",
      authentication: { method: "form", accounts: [{ name: "clerk", usernameEnv: "CLERK_USER", passwordEnv: "CLERK_PASSWORD" }] },
      environments: [{ name: "local", uiUrl: "http://127.0.0.1:3010" }],
    },
  ],
  knowledge: [],
  repository: { appsDir: "tests" },
  model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: "m", apiKeyEnv: "MODEL_KEY" },
};

/** A test repository that holds what is given, and the outputs of an initialisation run in it. */
function repository(files: Readonly<Record<string, string>>) {
  const root = mkdtempSync(join(workspace, "repo-"));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content);
  const out: string[] = [];
  const err: string[] = [];
  const init = () =>
    new RepositoryInit({ repositoryRoot: root, playwrightVersion: "1.64.1", write: (line) => err.push(line), print: (line) => out.push(line) }).run();
  return { root, out, err, init };
}

describe("the initialisation of a test repository as a Playwright project", () => {
  it("writes the files of the project from the configuration, without the secrets a run needs, and the folder of each application", async () => {
    const { root, out, err, init } = repository({ "oqas.json": JSON.stringify(CONFIG) });
    assert.deepEqual([await init(), err], [0, []]);
    assert.deepEqual(out, [
      `The test repository ${root} is a Playwright project at @playwright/test 1.64.1.\n`,
      "Created: package.json, playwright.config.ts, tsconfig.json, .gitignore, README.md, tests/fixtures.ts, tests/shop/pages/index.ts, tests/back-office/pages/index.ts, .github/workflows/tests.yml.\n",
      "Next: read what was created, run npm install, then commit it with the lockfile.\n",
    ]);
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { devDependencies: Record<string, string> };
    assert.equal(manifest.devDependencies["@playwright/test"], "1.64.1");
    assert.ok(readFileSync(join(root, "README.md"), "utf8").includes("| `tests/back-office/` | The tests of Back Office. |"));
    assert.deepEqual(
      [existsSync(join(root, "tests", "shop")), existsSync(join(root, "tests", "back-office")), existsSync(join(root, ".github", "workflows", "tests.yml"))],
      [true, true, true],
    );
  });

  it("writes no fixtures for tests that each stand alone, as the configuration may ask", async () => {
    const { root, out, init } = repository({ "oqas.json": JSON.stringify({ ...CONFIG, design: { architecture: "standalone" } }) });
    await init();
    assert.equal(out[1], "Created: package.json, playwright.config.ts, tsconfig.json, .gitignore, README.md, .github/workflows/tests.yml.\n");
    assert.equal(existsSync(join(root, "tests", "fixtures.ts")), false);
  });

  it("keeps every file the repository already has, and says so when nothing was missing", async () => {
    const { root, out, init } = repository({ "oqas.json": JSON.stringify(CONFIG), "package.json": '{ "name": "ours" }\n', "README.md": "# Ours\n" });
    await init();
    assert.deepEqual(
      [readFileSync(join(root, "package.json"), "utf8"), readFileSync(join(root, "README.md"), "utf8"), out.slice(1)],
      [
        '{ "name": "ours" }\n',
        "# Ours\n",
        [
          "Created: playwright.config.ts, tsconfig.json, .gitignore, tests/fixtures.ts, tests/shop/pages/index.ts, tests/back-office/pages/index.ts, .github/workflows/tests.yml.\n",
          "Kept as they were, already there: package.json, README.md.\n",
          "Next: read what was created, run npm install, then commit it with the lockfile.\n",
        ],
      ],
    );
    out.length = 0;
    await init();
    assert.deepEqual(out.slice(1), [
      "Kept as they were, already there: package.json, playwright.config.ts, tsconfig.json, .gitignore, README.md, tests/fixtures.ts, tests/shop/pages/index.ts, tests/back-office/pages/index.ts, .github/workflows/tests.yml.\n",
      "Nothing was missing.\n",
    ]);
  });

  it("stops with 3, and writes nothing, without a configuration or with an invalid one", async () => {
    const none = repository({});
    assert.deepEqual([await none.init(), none.err.length, existsSync(join(none.root, "package.json"))], [3, 1, false]);
    assert.match(
      none.err[0]!,
      /oqas\.json cannot be read; a test repository is initialised from the oqas\.json at its root, which declares its applications\.\n$/,
    );
    const wrong = repository({ "oqas.json": JSON.stringify({ ...CONFIG, applications: [] }) });
    assert.deepEqual([await wrong.init(), existsSync(join(wrong.root, "package.json"))], [3, false]);
    assert.ok(
      wrong.err.some((line) => line.startsWith("/applications")),
      wrong.err.join(""),
    );
    // An error about the whole file is told at its root.
    const broken = repository({ "oqas.json": "not json" });
    assert.deepEqual([await broken.init(), broken.err], [3, ["/: The file is not valid JSON.\n"]]);
  });
});

describe("the option --init of the command", () => {
  it("is read alone or with the repository, and refused with anything of a run", () => {
    const read = parseArguments(["--repository", "tests", "--init"]);
    assert.ok(read.ok && read.arguments.init && read.arguments.repository === "tests");
    for (const other of [
      ["--brief", "Test the orders."],
      ["--environment", "local"],
      ["--resume", "oqas-2026-11-13T12-00-00-000Z"],
      ["--force-cartography"],
      ["--follow"],
    ])
      assert.deepEqual(parseArguments(["--init", ...other]), {
        ok: false,
        error: "--init writes the files of the test repository and runs nothing: it takes --repository alone.",
      });
    const run = parseArguments([]);
    assert.ok(run.ok && !run.arguments.init);
  });

  it("initialises the repository at the version of Playwright of the product, and runs nothing", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", "oqas.json"), JSON.stringify(CONFIG));
    let out = "";
    let err = "";
    const code = await soloCommand(["--init", "--repository", "sub"], {
      env: {},
      cwd: root,
      stdout: { write: (text: string) => (out += text) },
      stderr: { write: (text: string) => (err += text) },
    });
    assert.deepEqual([code, err], [0, ""]);
    const installed = (JSON.parse(readFileSync(join(root, "sub", "package.json"), "utf8")) as { devDependencies: Record<string, string> }).devDependencies[
      "@playwright/test"
    ]!;
    assert.match(installed, /^\d+\.\d+\.\d+$/);
    assert.ok(out.includes(`is a Playwright project at @playwright/test ${installed}.`), out);
    // Without --repository, the repository is the folder the command runs in; what goes wrong goes to the error output.
    let complaint = "";
    const empty = mkdtempSync(join(workspace, "empty-"));
    const refused = await soloCommand(["--init"], {
      env: {},
      cwd: empty,
      stdout: { write: () => undefined },
      stderr: { write: (text: string) => (complaint += text) },
    });
    assert.deepEqual([refused, complaint.startsWith(join(empty, "oqas.json"))], [3, true]);
  });
});
