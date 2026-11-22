import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The model the configuration of a test repository names, which the scripted completions name too. */
export const MODEL = "test-model";

/** The connection string the configuration reads from the environment: a secret no output of a run may hold. */
export const WITNESS = "postgresql://shop:w1tness-pass@127.0.0.1:5999/shop";

/** Runs git in a folder, and answers what it printed. */
export const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

/**
 * The configuration of a test repository: one API of the shop, one document, a base declared for another environment.
 *
 * @param modelUrl - The address of the model server.
 * @param siteUrl - The address of the application under test.
 * @param changes - What the configuration holds besides, or instead.
 */
export function fixtureConfig(modelUrl: string, siteUrl: string, changes: Record<string, unknown> = {}): string {
  return JSON.stringify({
    formatVersion: 1,
    applications: [
      {
        id: "shop",
        name: "Shop",
        type: "api",
        authentication: { method: "none" },
        environments: [
          { name: "local", apis: [{ name: "backend", baseUrl: siteUrl }] },
          { name: "staging", apis: [{ name: "backend", baseUrl: "http://127.0.0.1:1" }] },
        ],
      },
    ],
    knowledge: [
      { id: "order-specs", type: "document", path: "specs/orders.md", attachments: [{ application: "shop", environment: "local" }] },
      { id: "shop-db", type: "postgresql", connectionStringEnv: "SHOP_DB_URL", attachments: [{ application: "shop", environment: "staging" }] },
    ],
    model: { mode: "provider-key", provider: "openai", baseUrl: modelUrl, model: MODEL },
    autonomy: { level: "autonomous" },
    // The review of a plan by an agent of its own has its sessions, which the design of the agents tests.
    // One level and no visual test: a design is then one pass, which the passes of a design test by themselves.
    design: { reviewPlan: false, reviewTests: false, reviewCode: false, levels: ["functional"], visualTests: false },
    ...changes,
  });
}

/** The base of the test repositories and of their remotes, by the folder they are made in: each repository of the folder copies it. */
const bases = new Map<string, { readonly root: string; readonly remote: string }>();

/**
 * Makes the base of the test repositories of a folder: a document and the base of the tests, committed and pushed to a
 * bare remote. It goes with the folder.
 */
function baseRepository(workspace: string): { readonly root: string; readonly remote: string } {
  const root = mkdtempSync(join(workspace, "base-"));
  const remote = mkdtempSync(join(workspace, "base-remote-"));
  git(remote, "init", "-q", "--bare", "-b", "main");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Test Maintainer");
  git(root, "config", "user.email", "maintainer@example.com");
  git(root, "config", "commit.gpgsign", "false");
  mkdirSync(join(root, "specs"));
  writeFileSync(join(root, "specs", "orders.md"), "# Orders\n\nA customer places an order.\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "tests", private: true, devDependencies: { "@playwright/test": "1.64.1" } }));
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/@playwright/test": { version: "1.64.1" } } }),
  );
  writeFileSync(join(root, ".gitignore"), ".oqas/\nnode_modules/\n");
  // The repository is a Playwright project already: the command runs in one that was initialised.
  writeFileSync(join(root, "playwright.config.ts"), "export default {};\n");
  // The types of @playwright/test the proposed tests are checked against: npm, a double here, installs nothing.
  mkdirSync(join(root, "node_modules", "@playwright", "test"), { recursive: true });
  writeFileSync(
    join(root, "node_modules", "@playwright", "test", "package.json"),
    JSON.stringify({ name: "@playwright/test", version: "1.64.1", types: "index.d.ts" }),
  );
  writeFileSync(
    join(root, "node_modules", "@playwright", "test", "index.d.ts"),
    "export interface APIResponse { ok(): boolean; text(): Promise<string>; }\nexport interface APIRequestContext { get(url: string): Promise<APIResponse>; }\nexport interface Page { goto(url: string): Promise<unknown>; }\ninterface Extending { extend<T>(fixtures: { [K in keyof T]: (given: { context: { newPage(): Promise<T[K]> } }, use: (value: T[K]) => Promise<void>) => Promise<void> }): TestType; }\ntype TestType = ((title: string, body: (fixtures: { request: APIRequestContext }) => Promise<void>) => void) & ((title: string, details: { tag: string[] }, body: (fixtures: { request: APIRequestContext }) => Promise<void>) => void) & { step<T>(title: string, body: () => Promise<T>): Promise<T> } & Extending;\nexport declare const test: TestType;\nexport declare function expect(value: unknown, message?: string): { toBe(expected: unknown): void; toContain(expected: string): void };\n",
  );
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "chore: start the test repository");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-q", "origin", "main");
  return { root, remote };
}

/**
 * A test repository with a remote, its configuration, a document and the base of the tests.
 *
 * @remarks
 * The repository and its remote are copies of a base made once in the folder, its origin the copy of the remote: git
 * starts a few times for each, not for every file. The configuration, when there is one, joins the one commit of the
 * base, which is pushed again.
 *
 * @param workspace - The folder the repository and its remote are made in.
 * @param config - The text of its configuration; none is written when left out.
 * @returns The absolute path of the repository.
 */
export function fixtureRepository(workspace: string, config: string | undefined): string {
  const base = bases.get(workspace) ?? baseRepository(workspace);
  bases.set(workspace, base);
  const root = mkdtempSync(join(workspace, "repo-"));
  const remote = mkdtempSync(join(workspace, "remote-"));
  cpSync(base.root, root, { recursive: true });
  cpSync(base.remote, remote, { recursive: true });
  const settings = join(root, ".git", "config");
  writeFileSync(settings, readFileSync(settings, "utf8").replace(base.remote, remote));
  if (config === undefined) return root;
  writeFileSync(join(root, "oqas.json"), config);
  git(root, "add", "oqas.json");
  git(root, "commit", "-q", "--amend", "--no-edit");
  git(root, "push", "-q", "--force", "origin", "main");
  return root;
}
