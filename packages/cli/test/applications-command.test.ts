import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { closedPort } from "@open-qa-stack/testing";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import { parseArguments, soloCommand } from "../src/index.ts";
import { addressLine } from "../src/solo/address-lines.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-applications-command-"));

/** A local application that answers 500 to every request. */
let server: Server;
let site: string;

beforeAll(async () => {
  server = createServer((_, response) => response.writeHead(500).end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  site = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(workspace, { recursive: true, force: true });
});

/** A test repository that holds a configuration, imported as the revision in force, and how to run oqas in it. */
async function repository(changes: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(workspace, "repo-"));
  writeFileSync(join(root, "oqas.json"), fixtureConfig("http://127.0.0.1:9/v1", site, changes));
  const env = { OQAS_DATABASE_URL: `sqlite:${join(workspace, `${root.split("/").at(-1)!}.db`)}` };
  const oqas = async (...argv: string[]) => {
    let out = "";
    let err = "";
    const code = await soloCommand(argv, {
      env,
      cwd: root,
      stdout: { write: (written: string) => (out += written) },
      stderr: { write: (written: string) => (err += written) },
    });
    return { code, out, err };
  };
  await oqas("config", "import");
  return oqas;
}

describe("oqas applications check", () => {
  it("criterion 4 — tests each address of the environments, an address that answers 500 answering, and exits with 4 when one does not", async () => {
    const refused = `http://127.0.0.1:${await closedPort()}/`;
    const oqas = await repository({
      applications: [
        {
          id: "shop",
          name: "Shop",
          type: "api",
          authentication: { method: "none" },
          environments: [
            { name: "local", apis: [{ name: "backend", baseUrl: site }] },
            { name: "staging", apis: [{ name: "backend", baseUrl: refused }] },
          ],
        },
      ],
    });
    assert.deepEqual(await oqas("applications", "check"), {
      code: 4,
      out: [
        `shop › local › backend  ${site}  answers, 500`,
        `shop › staging › backend  ${refused}  is refused: nothing listens on that port, check the port and that the application runs`,
        "",
      ].join("\n"),
      err: "",
    });
    const json = await oqas("applications", "check", "shop", "--output", "json");
    assert.equal(json.code, 4);
    assert.deepEqual(JSON.parse(json.out).checks[0], {
      application: "shop",
      environment: "local",
      address: "backend",
      check: { state: "answers", url: site, status: 500 },
    });
  });

  it("tests the interface of an environment beside its APIs, and exits with 0 when each answers", async () => {
    const oqas = await repository({
      applications: [{ id: "front", name: "Front", type: "web", authentication: { method: "none" }, environments: [{ name: "local", uiUrl: site }] }],
      knowledge: [],
    });
    assert.deepEqual(await oqas("applications", "check", "front"), { code: 0, out: `front › local › interface  ${site}  answers, 500\n`, err: "" });
  });

  it("is refused for an application the configuration does not declare, and where no address is declared", async () => {
    const oqas = await repository();
    const unknown = await oqas("applications", "check", "nowhere");
    assert.deepEqual([unknown.code, unknown.err], [3, "The configuration in force declares no application nowhere; oqas project names them.\n"]);
    const bare = await repository({
      applications: [{ id: "back", name: "Back", type: "api", authentication: { method: "none" }, environments: [{ name: "local" }] }],
      knowledge: [],
    });
    const none = await bare("applications", "check");
    assert.deepEqual([none.code, none.err], [3, "The environments of the applications declare no address to test.\n"]);
  });

  it("is read from its arguments: check, and an application at most, outside of any session", () => {
    assert.deepEqual(parseArguments(["applications", "check"]), {
      ok: true,
      arguments: { output: "text", follow: false, command: { name: "applications", action: "check" } },
    });
    assert.equal(parseArguments(["applications", "check", "shop"]).ok, true);
    for (const args of [["applications"], ["applications", "list"], ["applications", "check", "a", "b"]])
      assert.deepEqual(parseArguments(args), { ok: false, error: "oqas applications takes check, and an application at most." }, args.join(" "));
    assert.deepEqual(parseArguments(["applications", "check", "--follow"]), {
      ok: false,
      error: "oqas applications acts on the applications of the configuration: it takes no --brief, --environment nor --follow.",
    });
  });
});

describe("the line of an address tested", () => {
  it("criterion 2 — says what to correct for each reason an address does not answer, naming it", () => {
    const where = { application: "shop", environment: "local", address: "interface" };
    const line = (check: Parameters<typeof addressLine>[0]["check"]) => addressLine({ ...where, check });
    assert.equal(line({ state: "malformed", url: "shop" }), "shop › local › interface  shop  is no http or https address: check how it is written");
    assert.equal(
      line({ state: "unknown-host", url: "https://a.test/" }),
      "shop › local › interface  https://a.test/  names no machine: check the name, often a typo",
    );
    assert.equal(
      line({ state: "timeout", url: "https://a.test/" }),
      "shop › local › interface  https://a.test/  does not answer within ten seconds: check that the application runs and can be reached from here",
    );
    assert.equal(
      line({ state: "unreachable", url: "https://a.test/", code: "ECONNRESET" }),
      "shop › local › interface  https://a.test/  cannot be reached (ECONNRESET): check the address and the network",
    );
    assert.equal(
      line({ state: "unreachable", url: "https://a.test/" }),
      "shop › local › interface  https://a.test/  cannot be reached: check the address and the network",
    );
  });
});
