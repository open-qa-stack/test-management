import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_FILE_NAME,
  ConfigurationConflictError,
  configurationText,
  InvalidConfigurationError,
  NoConfigurationError,
  StaleRevisionError,
  type OqasConfig,
} from "@open-qa-stack/domain";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import { afterAll, describe, it } from "vitest";
import { Configuration, NoRepositoryError } from "../src/index.ts";
import { MemoryConfigurationStore } from "./support/memory-configuration-store.ts";

/** The configuration of the test repositories, as their file holds it. */
const TEXT = fixtureConfig("http://127.0.0.1:9/v1", "http://127.0.0.1:9/");

/** That configuration, read. */
const DOCUMENT = JSON.parse(TEXT) as OqasConfig;

/** The same configuration, with one more environment. */
const CHANGED = {
  ...DOCUMENT,
  applications: [{ ...DOCUMENT.applications[0]!, environments: [...DOCUMENT.applications[0]!.environments, { name: "qa", apis: [] }] }],
} as OqasConfig;

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** A test repository whose configuration file holds a given text; none when the text is left out. */
function repositoryWith(text?: string): string {
  const folder = mkdtempSync(join(tmpdir(), "oqas-configuration-"));
  folders.push(folder);
  if (text !== undefined) writeFileSync(join(folder, CONFIG_FILE_NAME), text);
  return folder;
}

/** The SHA-256 digest of a text, in hexadecimal. */
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** The operations on the configuration of a test repository, on a store of their own. */
function configurationOf(
  repository: string | undefined,
  store = new MemoryConfigurationStore(),
): { configuration: Configuration; store: MemoryConfigurationStore } {
  return { configuration: new Configuration(store, repository), store };
}

/** What the configuration file of a test repository holds. */
const fileOf = (repository: string) => readFileSync(join(repository, CONFIG_FILE_NAME), "utf8");

describe("the configuration of an instance, synchronised with its file", () => {
  it("takes a file it never read as its first revision, and leaves the revision in force as it is while the file does not change", async () => {
    const repository = repositoryWith(TEXT);
    const { configuration } = configurationOf(repository);
    assert.deepEqual(await configuration.view(), { file: "changed" });
    const first = await configuration.synchronise();
    assert.deepEqual(first, { number: 1, recordedAt: "2026-11-18T09:00:00.000Z", origin: "file", fileDigest: digest(TEXT), document: DOCUMENT });
    assert.deepEqual(await configuration.synchronise(), first);
    assert.deepEqual(await configuration.view(), { revision: first, file: "in_step" });
    assert.deepEqual(await configuration.revisions(), [{ number: 1, recordedAt: "2026-11-18T09:00:00.000Z", origin: "file", fileDigest: digest(TEXT) }]);
  });

  it("takes a file that changed as a new revision, and refuses one that is no valid configuration, the revision in force kept", async () => {
    const repository = repositoryWith(TEXT);
    const { configuration } = configurationOf(repository);
    await configuration.synchronise();
    writeFileSync(join(repository, CONFIG_FILE_NAME), JSON.stringify(CHANGED));
    assert.deepEqual(await configuration.view().then(({ file }) => file), "changed");
    const second = await configuration.synchronise();
    assert.deepEqual([second.number, second.origin, second.document], [2, "file", CHANGED]);
    writeFileSync(join(repository, CONFIG_FILE_NAME), JSON.stringify({ ...CHANGED, applications: [] }));
    await assert.rejects(
      configuration.synchronise(),
      (error) =>
        error instanceof InvalidConfigurationError && error.message.startsWith(`${CONFIG_FILE_NAME} is not`) && error.errors[0]!.rule === "too-few-items",
    );
    assert.equal((await configuration.view()).revision!.number, 2);
  });

  it("keeps the revision in force while the file cannot be read, and has no configuration without either", async () => {
    const repository = repositoryWith(TEXT);
    const { configuration } = configurationOf(repository);
    const first = await configuration.synchronise();
    unlinkSync(join(repository, CONFIG_FILE_NAME));
    assert.deepEqual(await configuration.synchronise(), first);
    assert.equal((await configuration.view()).file, "missing");
    const empty = repositoryWith();
    await assert.rejects(configurationOf(empty).configuration.synchronise(), new NoConfigurationError(join(empty, CONFIG_FILE_NAME)));
    await assert.rejects(configurationOf(undefined).configuration.synchronise(), new NoConfigurationError(CONFIG_FILE_NAME));
    assert.deepEqual(await configurationOf(undefined).configuration.view(), { file: "missing" });
  });

  it("gives the revision another process took from the same file meanwhile, and lets any other refusal of the store through", async () => {
    const repository = repositoryWith(TEXT);
    const shared = new MemoryConfigurationStore();
    const { configuration } = configurationOf(repository, shared);
    const other = configurationOf(repository, shared).configuration;
    // The other process records the file while this one, which read the store before, records it too.
    shared.before = async () => {
      shared.before = () => undefined;
      await other.synchronise();
    };
    const taken = await configuration.synchronise();
    assert.deepEqual([taken.number, taken.origin], [1, "file"]);
    assert.equal((await shared.revisions()).length, 1);
    writeFileSync(join(repository, CONFIG_FILE_NAME), JSON.stringify(CHANGED));
    shared.before = async () => {
      shared.before = () => undefined;
      await shared.record({ origin: "console", fileDigest: "elsewhere", document: DOCUMENT }, 1);
    };
    await assert.rejects(configuration.synchronise(), StaleRevisionError);
    shared.before = () => Promise.reject(new Error("The store does not answer."));
    await assert.rejects(configuration.synchronise(), /The store does not answer\./);
  });
});

describe("a change of the configuration saved from the console", () => {
  it("becomes a revision of origin console, and rewrites the file in the order of the schema", async () => {
    const repository = repositoryWith(TEXT);
    const { configuration } = configurationOf(repository);
    await configuration.synchronise();
    const saved = await configuration.save(CHANGED, 1);
    const text = configurationText(CHANGED);
    assert.deepEqual(saved, { number: 2, recordedAt: "2026-11-18T09:00:00.000Z", origin: "console", fileDigest: digest(text), document: CHANGED });
    assert.equal(fileOf(repository), text);
    assert.deepEqual(await configuration.view(), { revision: saved, file: "in_step" });
    assert.deepEqual(await configuration.synchronise(), saved);
    const first = repositoryWith();
    const created = await configurationOf(first).configuration.save(DOCUMENT, 0);
    assert.deepEqual([created.number, fileOf(first)], [1, configurationText(DOCUMENT)]);
  });

  it("is checked by the schema of the file without anything recorded, and refused when it is not valid", async () => {
    const repository = repositoryWith(TEXT);
    const { configuration } = configurationOf(repository);
    assert.deepEqual(configuration.check(DOCUMENT), []);
    const wrong = { ...DOCUMENT, model: { ...DOCUMENT.model, apiKeyEnv: "not a name" } };
    assert.deepEqual(
      configuration.check(wrong).map(({ path, rule }) => `${path} ${rule}`),
      ["/model/apiKeyEnv env-var-name"],
    );
    await assert.rejects(configuration.save(wrong, 0), (error) => error instanceof InvalidConfigurationError && error.message.startsWith("The change is not"));
    assert.deepEqual(await configuration.revisions(), []);
  });

  it("is refused when it was made from a revision another replaced since, or when the file changed too, unless the person keeps the change over the file", async () => {
    const repository = repositoryWith(TEXT);
    const { configuration } = configurationOf(repository);
    await configuration.synchronise();
    await assert.rejects(configuration.save(CHANGED, 0), new StaleRevisionError(0, 1));
    writeFileSync(join(repository, CONFIG_FILE_NAME), JSON.stringify(CHANGED, null, 4));
    await assert.rejects(configuration.save(CHANGED, 1), ConfigurationConflictError);
    assert.equal((await configuration.revisions()).length, 1);
    const kept = await configuration.save(DOCUMENT, 1, true);
    assert.deepEqual([kept.number, kept.origin, fileOf(repository)], [2, "console", configurationText(DOCUMENT)]);
  });

  it("is refused by a host that has no test repository, whose file it would rewrite", async () => {
    await assert.rejects(
      configurationOf(undefined).configuration.save(DOCUMENT, 0),
      (error) => error instanceof NoRepositoryError && error.message === "The configuration cannot be changed: the host was given no test repository.",
    );
  });
});

describe("the revision in force written back to the file", () => {
  it("rewrites a file that changed, as a revision of origin command, and leaves one in step as it is", async () => {
    const repository = repositoryWith(TEXT);
    const { configuration } = configurationOf(repository);
    const first = await configuration.synchronise();
    assert.deepEqual(await configuration.restore(), { ...first });
    writeFileSync(join(repository, CONFIG_FILE_NAME), "{");
    const restored = await configuration.restore();
    assert.deepEqual([restored.number, restored.origin, restored.document], [2, "command", DOCUMENT]);
    assert.equal(fileOf(repository), configurationText(DOCUMENT));
    unlinkSync(join(repository, CONFIG_FILE_NAME));
    assert.equal((await configuration.restore()).number, 3);
    assert.equal(fileOf(repository), configurationText(DOCUMENT));
  });

  it("is refused without a revision, or without a test repository", async () => {
    const empty = repositoryWith();
    await assert.rejects(configurationOf(empty).configuration.restore(), NoConfigurationError);
    await assert.rejects(configurationOf(undefined).configuration.restore(), new NoRepositoryError("The configuration file cannot be written"));
  });
});
