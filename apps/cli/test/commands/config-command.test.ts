import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";
import { configurationText, type OqasConfig } from "@open-qa-stack/domain";
import { Configuration } from "@open-qa-stack/engine";
import { DatabaseUrl, InstanceDatabase } from "@open-qa-stack/store";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import { parseArguments, runOqas } from "../../src/index.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-config-command-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

/** The configuration of the test repositories, as their file first holds it. */
const TEXT = fixtureConfig("http://127.0.0.1:9/v1", "http://127.0.0.1:9/");

/** A date as the store writes it. */
const DATE = "\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z";

/** A test repository that holds a configuration file, the database of its instance kept beside it, and how to run oqas in it. */
function repository() {
  const root = mkdtempSync(join(workspace, "repo-"));
  writeFileSync(join(root, "oqas.json"), TEXT);
  const database = join(workspace, `${root.split("/").at(-1)!}.db`);
  const env = { OQAS_DATABASE_URL: `sqlite:${database}` };
  const oqas = async (...argv: string[]) => {
    let out = "";
    let err = "";
    const code = await runOqas(argv, {
      env,
      cwd: root,
      stdout: { write: (text: string) => (out += text) },
      stderr: { write: (text: string) => (err += text) },
    });
    return { code, out, err };
  };
  return { root, database, oqas, file: () => readFileSync(join(root, "oqas.json"), "utf8") };
}

describe("oqas config", () => {
  it("shows the configuration in force and how the file stands to it, takes the file, and writes the configuration in force over a file that differs", async () => {
    const { root, oqas, file } = repository();
    assert.deepEqual(await oqas("config", "show"), {
      code: 0,
      out: "The instance keeps no revision of the configuration.\noqas.json differs from it: oqas config export writes the revision in force over it, oqas config import takes it instead.\n",
      err: "",
    });
    const imported = await oqas("config", "import");
    assert.match(imported.out, new RegExp(`^Revision 1 of the configuration, taken from oqas\\.json on ${DATE}\\.\\noqas\\.json holds it\\.\\n$`));
    const shown = await oqas("config", "show");
    assert.equal(shown.out.split("\n").slice(2).join("\n"), configurationText(JSON.parse(TEXT) as OqasConfig));
    writeFileSync(join(root, "oqas.json"), "{");
    assert.deepEqual(await oqas("config", "import"), {
      code: 3,
      out: "",
      err: "/: The file is not valid JSON.\nCorrect oqas.json, or write the revision 1 in force over it with oqas config export.\n",
    });
    const exported = await oqas("config", "export");
    assert.match(exported.out, new RegExp(`^Revision 1 of the configuration, taken from oqas\\.json on ${DATE}\\.\\noqas\\.json holds it\\.\\n$`));
    assert.equal(file(), configurationText(JSON.parse(TEXT) as OqasConfig));
    unlinkSync(join(root, "oqas.json"));
    assert.match((await oqas("config", "show")).out, /\nThere is no oqas\.json: oqas config export writes the revision in force to it\.\n/);
  });

  it("prints the configuration as it is now in JSON, and names a change saved in the console", async () => {
    const { root, database, oqas } = repository();
    const instance = new InstanceDatabase(DatabaseUrl.ofFile(database), { log() {}, warn() {} });
    await instance.prepare();
    try {
      const configuration = new Configuration(instance.configuration, root);
      await configuration.synchronise();
      await configuration.save({ ...(JSON.parse(TEXT) as OqasConfig), knowledge: [] }, 1);
    } finally {
      await instance.close();
    }
    const json = await oqas("config", "show", "--output", "json");
    const view = JSON.parse(json.out) as { revision: { number: number; origin: string; document: OqasConfig }; file: string };
    assert.deepEqual([view.revision.number, view.revision.origin, view.revision.document.knowledge, view.file], [2, "console", [], "changed"]);
    assert.match((await oqas("config", "show")).out, new RegExp(`^Revision 2 of the configuration, saved in the console on ${DATE}\\.\\n`));
  });

  it("says a file that cannot be read tells where the sessions are kept", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    mkdirSync(join(root, "oqas.json"));
    let err = "";
    const code = await runOqas(["config", "show"], {
      env: {},
      cwd: root,
      stdout: { write: () => true },
      stderr: { write: (text: string) => (err += text) },
    });
    assert.deepEqual(
      [code, err],
      [3, `${join(root, "oqas.json")} cannot be read: it says where the sessions are kept. Correct it, or remove it and start again with oqas --ui.\n`],
    );
  });

  it("tells what to write when there is neither a revision nor a file", async () => {
    const { root, oqas } = repository();
    unlinkSync(join(root, "oqas.json"));
    assert.deepEqual(await oqas("config", "export"), {
      code: 3,
      out: "",
      err: `${join(root, "oqas.json")} cannot be read, and the instance keeps no revision of the configuration. Start with oqas in a terminal or oqas --ui, which set it up step by step, or write a oqas.json at the root of the test repository.\n`,
    });
  });

  it("refuses to initialise the test repository from a file that is not valid, which it says how to correct", async () => {
    const { root, oqas } = repository();
    writeFileSync(join(root, "oqas.json"), "{");
    assert.deepEqual(await oqas("--init"), { code: 3, out: "", err: "/: The file is not valid JSON.\nCorrect oqas.json.\n" });
  });

  it("takes one action among show, import and export, and nothing of a session", () => {
    assert.deepEqual(parseArguments(["config", "export", "--output", "json"]), {
      ok: true,
      arguments: { output: "json", follow: false, command: { name: "config", action: "export" } },
    });
    for (const argv of [["config"], ["config", "list"], ["config", "show", "now"]])
      assert.deepEqual(parseArguments(argv), { ok: false, error: "oqas config takes show, import, export, history or check." });
    for (const argv of [
      ["config", "show", "--follow"],
      ["config", "show", "--environment", "local"],
    ])
      assert.deepEqual(parseArguments(argv), { ok: false, error: "oqas config acts on the configuration: it takes no --brief, --environment nor --follow." });
  });
});
