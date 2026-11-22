import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_FILE_NAME,
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

describe("the configuration of an instance, kept in its store", () => {
  it("takes the file as its first revision when it keeps none, then reads the file no more", async () => {
    const repository = repositoryWith(TEXT);
    const { configuration } = configurationOf(repository);
    assert.deepEqual(await configuration.view(), { file: "changed" });
    const first = await configuration.current();
    assert.deepEqual(first, { number: 1, recordedAt: "2026-11-18T09:00:00.000Z", origin: "file", fileDigest: digest(TEXT), document: DOCUMENT });
    assert.deepEqual(await configuration.view(), { revision: first, file: "in_step" });
    // A file that changed afterwards is told, and taken only when a person asks for it.
    writeFileSync(join(repository, CONFIG_FILE_NAME), JSON.stringify(CHANGED));
    assert.deepEqual(await configuration.current(), first);
    assert.deepEqual(await configuration.inForce(), first);
    assert.equal((await configuration.view()).file, "changed");
    assert.deepEqual(await configuration.revisions(), [{ number: 1, recordedAt: "2026-11-18T09:00:00.000Z", origin: "file", fileDigest: digest(TEXT) }]);
  });

  it("has no configuration without a revision nor a valid file, which a host starting is not refused for", async () => {
    const empty = repositoryWith();
    await assert.rejects(configurationOf(empty).configuration.current(), new NoConfigurationError(join(empty, CONFIG_FILE_NAME)));
    assert.equal(await configurationOf(empty).configuration.inForce(), undefined);
    const wrong = repositoryWith(JSON.stringify({ ...DOCUMENT, applications: [] }));
    await assert.rejects(configurationOf(wrong).configuration.current(), InvalidConfigurationError);
    assert.equal(await configurationOf(wrong).configuration.inForce(), undefined);
    await assert.rejects(configurationOf(undefined).configuration.current(), new NoConfigurationError(CONFIG_FILE_NAME));
    assert.deepEqual(await configurationOf(undefined).configuration.view(), { file: "missing" });
    const failing = new MemoryConfigurationStore();
    failing.before = () => Promise.reject(new Error("The store does not answer."));
    await assert.rejects(configurationOf(repositoryWith(TEXT), failing).configuration.inForce(), /The store does not answer\./);
  });
});

describe("the configuration file taken as the revision in force", () => {
  it("is a new revision when it differs, and is refused when it is no valid configuration, the revision in force kept", async () => {
    const repository = repositoryWith(TEXT);
    const { configuration } = configurationOf(repository);
    const first = await configuration.synchronise();
    assert.deepEqual(await configuration.synchronise(), first);
    writeFileSync(join(repository, CONFIG_FILE_NAME), JSON.stringify(CHANGED));
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

  it("keeps the revision in force while the file cannot be read, and gives no configuration without either", async () => {
    const repository = repositoryWith(TEXT);
    const { configuration } = configurationOf(repository);
    const first = await configuration.synchronise();
    unlinkSync(join(repository, CONFIG_FILE_NAME));
    assert.deepEqual(await configuration.synchronise(), first);
    assert.equal((await configuration.view()).file, "missing");
    const empty = repositoryWith();
    await assert.rejects(configurationOf(empty).configuration.synchronise(), new NoConfigurationError(join(empty, CONFIG_FILE_NAME)));
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
  });
});

describe("a change of the configuration saved from the console or a command", () => {
  it("becomes a revision of its origin, and writes no file, which then differs from it", async () => {
    const repository = repositoryWith(TEXT);
    const { configuration } = configurationOf(repository);
    await configuration.current();
    const saved = await configuration.save(CHANGED, 1);
    assert.deepEqual(saved, {
      number: 2,
      recordedAt: "2026-11-18T09:00:00.000Z",
      origin: "console",
      fileDigest: digest(configurationText(CHANGED)),
      document: CHANGED,
    });
    assert.equal(fileOf(repository), TEXT);
    assert.deepEqual(await configuration.view(), { revision: saved, file: "changed" });
    assert.deepEqual(await configuration.current(), saved);
    assert.equal((await configuration.save(DOCUMENT, 2, "command")).origin, "command");
    // A host without a test repository keeps its configuration all the same.
    const created = await configurationOf(undefined).configuration.save(DOCUMENT, 0);
    assert.equal(created.number, 1);
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

  it("is refused when it was made from a revision another replaced since", async () => {
    const { configuration } = configurationOf(repositoryWith(TEXT));
    await configuration.current();
    await assert.rejects(configuration.save(CHANGED, 0), new StaleRevisionError(0, 1));
    assert.equal((await configuration.revisions()).length, 1);
  });
});

describe("the revision in force written to the file", () => {
  it("rewrites a file that differs in the order of the schema, the revision in force kept, and leaves one that holds it as it is", async () => {
    const repository = repositoryWith(TEXT);
    const { configuration } = configurationOf(repository);
    const first = await configuration.current();
    writeFileSync(join(repository, CONFIG_FILE_NAME), "{");
    assert.deepEqual(await configuration.restore(), first);
    assert.equal(fileOf(repository), configurationText(DOCUMENT));
    // The file written holds the revision, whatever the layout of the file it was read from: taking it again changes nothing.
    assert.deepEqual(await configuration.view(), { revision: first, file: "in_step" });
    assert.deepEqual(await configuration.synchronise(), first);
    assert.deepEqual(await configuration.restore(), first);
    unlinkSync(join(repository, CONFIG_FILE_NAME));
    await configuration.restore();
    assert.equal(fileOf(repository), configurationText(DOCUMENT));
    assert.equal((await configuration.revisions()).length, 1);
  });

  it("is refused without a revision, or without a test repository", async () => {
    const empty = repositoryWith();
    await assert.rejects(configurationOf(empty).configuration.restore(), NoConfigurationError);
    await assert.rejects(configurationOf(undefined).configuration.restore(), new NoRepositoryError("The configuration file cannot be written"));
  });
});
