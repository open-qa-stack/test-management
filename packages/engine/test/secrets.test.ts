import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";
import { SecretRefusedError, UnknownSecretError } from "@open-qa-stack/domain";
import { configText } from "@open-qa-stack/testing/test-repository";
import { Configuration, FileSecretStore, NoRepositoryError, Secrets, SECRETS_FOLDER } from "../src/index.ts";
import { environmentOf } from "../src/secrets/environment-of.ts";
import { MemoryConfigurationStore } from "./support/memory-configuration-store.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-secrets-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

/** The configuration of the fixtures, whose database is read with SHOP_DB_URL, with a model whose key is in MODEL_KEY and one account. */
const CONFIG = configText("http://127.0.0.1:9/v1", {
  model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "m", apiKeyEnv: "MODEL_KEY" },
});

/** A test repository with that configuration file, or none, its operations on the configuration, and the store of its values. */
function repository(config: string | null = CONFIG): { root: string; configuration: Configuration; store: FileSecretStore } {
  const root = mkdtempSync(join(workspace, "repo-"));
  if (config !== null) writeFileSync(join(root, "oqas.json"), config);
  return { root, configuration: new Configuration(new MemoryConfigurationStore(), root), store: FileSecretStore.of(root) };
}

describe("the store of the values of the variables, in the state folder of the test repository", () => {
  it("holds nothing at first, then keeps the values in a file only its owner reads, in a folder git leaves out", async () => {
    const { root, store } = repository();
    assert.deepEqual(await store.read(), {});
    await store.write({ MODEL_KEY: "sk-1" });
    const folder = join(root, ".oqas", SECRETS_FOLDER);
    assert.equal(readFileSync(join(folder, ".gitignore"), "utf8"), "*\n");
    assert.equal(statSync(join(folder, "values.json")).mode & 0o777, 0o600);
    assert.deepEqual(await store.read(), { MODEL_KEY: "sk-1" });
  });

  it("is in the state folder the configuration file names, the default one without a file", () => {
    const named = repository(JSON.stringify({ repository: { stateDir: "state" } }));
    mkdirSync(join(named.root, "state", SECRETS_FOLDER), { recursive: true });
    writeFileSync(join(named.root, "state", SECRETS_FOLDER, "values.json"), '{"A":"a"}');
    return Promise.all([
      FileSecretStore.of(named.root)
        .read()
        .then((values) => assert.deepEqual(values, { A: "a" })),
      FileSecretStore.of(repository(null).root)
        .read()
        .then((values) => assert.deepEqual(values, {})),
    ]);
  });

  it("refuses values it cannot read, and says what to do", async () => {
    const { root, store } = repository();
    const folder = join(root, ".oqas", SECRETS_FOLDER);
    mkdirSync(folder, { recursive: true });
    for (const text of ["not json", '{"A":1}', "[]"]) {
      writeFileSync(join(folder, "values.json"), text);
      await assert.rejects(
        store.read(),
        /values\.json cannot be read: it holds the values saved for the variables of the configuration\. Remove it, and give them again\./,
      );
    }
    rmSync(join(folder, "values.json"));
    mkdirSync(join(folder, "values.json"));
    await assert.rejects(store.read(), { code: "EISDIR" });
  });
});

describe("the values of the variables the configuration names", () => {
  it("lists each variable once, where it is named, and where its value comes from", async () => {
    const { configuration, store } = repository();
    await store.write({ MODEL_KEY: "saved", STALE: "x" });
    const secrets = new Secrets(configuration, { SHOP_DB_URL: "from-env", EMPTY: "" }, store);
    assert.deepEqual(await secrets.list(), [
      { name: "SHOP_DB_URL", kind: "connection_string", paths: ["/knowledge/1/connectionStringEnv"], source: "environment" },
      { name: "MODEL_KEY", kind: "model_key", paths: ["/model/apiKeyEnv"], source: "saved" },
    ]);
  });

  it("lists none without a configuration", async () => {
    const { configuration, store } = repository(null);
    assert.deepEqual(await new Secrets(configuration, {}, store).list(), []);
  });

  it("saves a value in place of the one saved, which the environment of the next run reads, the environment of the process winning", async () => {
    const { configuration, store } = repository();
    const secrets = new Secrets(configuration, { SHOP_DB_URL: "from-env", EMPTY: "" }, store);
    await secrets.save("MODEL_KEY", "first");
    await secrets.save("MODEL_KEY", "second");
    assert.deepEqual(await store.read(), { MODEL_KEY: "second" });
    await store.write({ MODEL_KEY: "second", SHOP_DB_URL: "saved-before" });
    const env = await environmentOf(secrets);
    assert.equal(env["MODEL_KEY"], "second");
    assert.equal(env["SHOP_DB_URL"], "from-env");
    assert.equal("EMPTY" in env, false);
  });

  it("refuses a variable the configuration does not name, an empty value, and one the environment sets", async () => {
    const { configuration, store } = repository();
    const secrets = new Secrets(configuration, { SHOP_DB_URL: "from-env" }, store);
    await assert.rejects(secrets.save("NODE_OPTIONS", "--require x"), new UnknownSecretError("NODE_OPTIONS"));
    await assert.rejects(secrets.save("MODEL_KEY", ""), new SecretRefusedError("The value of MODEL_KEY is empty: give one."));
    await assert.rejects(
      secrets.save("SHOP_DB_URL", "other"),
      new SecretRefusedError("SHOP_DB_URL is set in the environment of the process, which wins over a value saved: change it there, or start oqas without it."),
    );
    assert.deepEqual(await store.read(), {});
  });

  it("saves nothing for a host without a test repository, which reads the environment of its process alone", async () => {
    const { configuration } = repository();
    const secrets = new Secrets(configuration, { A: "a" });
    await assert.rejects(secrets.save("MODEL_KEY", "k"), new NoRepositoryError("No value can be saved"));
    assert.deepEqual(await secrets.current(), { A: "a" });
  });

  it("are read as they are now by whoever is given what reads them, and an environment as it is", async () => {
    assert.deepEqual(await environmentOf({ current: "a text" }), { current: "a text" });
    assert.deepEqual(await environmentOf({ current: () => Promise.resolve({ B: "b" }) }), { B: "b" });
  });
});
