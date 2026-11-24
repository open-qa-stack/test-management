import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, it } from "vitest";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import { soloCommand } from "../src/index.ts";
import type { CommandIo, CommandTerminal } from "../src/solo/command-io.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-secrets-command-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

/** The configuration of the test repositories: its database is read with SHOP_DB_URL, its model with the key in MODEL_KEY. */
const TEXT = fixtureConfig("http://127.0.0.1:9/v1", "http://127.0.0.1:9/", {
  model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "m", apiKeyEnv: "MODEL_KEY" },
});

/** A terminal whose input the test types in, and whose output it reads. */
function terminal(): { terminal: CommandTerminal; shown: () => string; typed: PassThrough } {
  const typed = new PassThrough();
  const shown = new PassThrough();
  let text = "";
  shown.on("data", (chunk: Buffer) => (text += chunk.toString()));
  return { terminal: { stdin: typed, stdout: shown } as unknown as CommandTerminal, shown: () => text, typed };
}

/** A test repository with its database beside it, and how to run oqas in it with what it is given. */
function repository(env: Record<string, string> = {}) {
  const root = mkdtempSync(join(workspace, "repo-"));
  writeFileSync(join(root, "oqas.json"), TEXT);
  const oqas = async (argv: string[], given: Pick<CommandIo, "terminal" | "input"> = {}) => {
    let out = "";
    let err = "";
    const code = await soloCommand(argv, {
      env: { OQAS_DATABASE_URL: `sqlite:${join(root, "instance.db")}`, ...env },
      cwd: root,
      ...given,
      stdout: { write: (text: string) => (out += text) },
      stderr: { write: (text: string) => (err += text) },
    });
    return { code, out, err };
  };
  const saved = () => JSON.parse(readFileSync(join(root, ".oqas", "secrets", "values.json"), "utf8")) as Record<string, string>;
  return { oqas, saved };
}

describe("oqas secrets", () => {
  it("lists the variables the configuration names and where each value comes from, and how to give one missing", async () => {
    const { oqas } = repository({ SHOP_DB_URL: "postgres://shop" });
    const told = await oqas(["secrets"]);
    assert.deepEqual(
      [told.code, told.out],
      [
        0,
        "SHOP_DB_URL  a connection string, set in the environment\nMODEL_KEY  the key of the model, missing\n" +
          "Give a missing value with oqas secrets set <variable>, or in the console (oqas --ui), or set the variable in the environment.\n",
      ],
    );
    const json = JSON.parse((await oqas(["secrets", "--output", "json"])).out) as { secrets: { name: string; source: string }[] };
    assert.deepEqual(
      json.secrets.map(({ name, source }) => `${name} ${source}`),
      ["SHOP_DB_URL environment", "MODEL_KEY missing"],
    );
  });

  it("saves a value read from the input, without its last line break, and lists it as saved", async () => {
    const { oqas, saved } = repository({ SHOP_DB_URL: "postgres://shop" });
    const told = await oqas(["secrets", "set", "MODEL_KEY"], {
      input: (async function* () {
        yield "sk-";
        yield new TextEncoder().encode("piped\n");
      })(),
    });
    assert.equal(told.code, 0);
    assert.equal(told.err, "MODEL_KEY is saved on this machine, out of the test repository.\n");
    assert.match(told.out, /^SHOP_DB_URL {2}a connection string, set in the environment\nMODEL_KEY {2}the key of the model, saved on this machine\n$/);
    assert.deepEqual(saved(), { MODEL_KEY: "sk-piped" });
  });

  it("asks for the value in a terminal without showing it", async () => {
    const { oqas, saved } = repository();
    const { terminal: screen, shown, typed } = terminal();
    const ended = oqas(["secrets", "set", "MODEL_KEY"], { terminal: screen });
    await new Promise((resolve) => setTimeout(resolve, 50));
    typed.write("hidden-key\r");
    assert.equal((await ended).code, 0);
    assert.equal(shown(), "Value of MODEL_KEY (not shown): \n");
    assert.deepEqual(saved(), { MODEL_KEY: "hidden-key" });
  });

  it("saves nothing when the person stops typing, or gives no value", async () => {
    const { oqas } = repository();
    const { terminal: screen, typed } = terminal();
    const ended = oqas(["secrets", "set", "MODEL_KEY"], { terminal: screen });
    await new Promise((resolve) => setTimeout(resolve, 50));
    typed.write("\u0003");
    assert.deepEqual(await ended, { code: 3, out: "", err: "Nothing was saved.\n" });
    const none = await oqas(["secrets", "set", "MODEL_KEY"]);
    assert.equal(none.code, 3);
    assert.match(
      none.err,
      /^No value was given: type it in a terminal, or give it on the input, as in: printf %s "\$VALUE" \| oqas secrets set <variable>\.\n$/,
    );
  });

  it("refuses a variable the configuration does not name, and one the environment sets", async () => {
    const { oqas } = repository({ SHOP_DB_URL: "postgres://shop" });
    const input = (value: string) => ({
      input: (async function* () {
        yield value;
      })(),
    });
    assert.deepEqual(await oqas(["secrets", "set", "NODE_OPTIONS"], input("x")), {
      code: 3,
      out: "",
      err: "The configuration in force names no variable NODE_OPTIONS.\n",
    });
    const set = await oqas(["secrets", "set", "SHOP_DB_URL"], input("x"));
    assert.equal(set.code, 3);
    assert.match(set.err, /^SHOP_DB_URL is set in the environment of the process, which wins over a value saved/);
  });

  it("says when the configuration names no variable", async () => {
    const root = mkdtempSync(join(workspace, "bare-"));
    const bare = JSON.parse(fixtureConfig("http://127.0.0.1:9/v1", "http://127.0.0.1:9/")) as { knowledge: { type: string }[] };
    writeFileSync(join(root, "oqas.json"), JSON.stringify({ ...bare, knowledge: bare.knowledge.filter(({ type }) => type !== "postgresql") }));
    let out = "";
    await soloCommand(["secrets"], {
      env: { OQAS_DATABASE_URL: `sqlite:${join(root, "i.db")}` },
      cwd: root,
      stdout: { write: (text: string) => (out += text) },
      stderr: { write: () => undefined },
    });
    assert.equal(out, "The configuration in force names no variable.\n");
  });
});
