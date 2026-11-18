import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { scriptedServer } from "@open-qa-stack/testing";
import { soloCommand } from "../src/index.ts";
import { WITNESS, siteUrl, configText, repository, FakeRunner, FIRST_RUN, later, journalOf } from "./solo-run-support.ts";

describe("the edges of a run", () => {
  it("takes the folder it runs in as the test repository, and the only environment declared", async () => {
    const server = await scriptedServer([]);
    const single = configText(server.baseUrl, {
      applications: [
        {
          id: "shop",
          name: "Shop",
          type: "api",
          authentication: { method: "none" },
          environments: [{ name: "local", apis: [{ name: "backend", baseUrl: siteUrl }] }],
        },
      ],
      knowledge: [{ id: "order-specs", type: "document", path: "specs/orders.md", attachments: [{ application: "shop" }] }],
    });
    const root = repository(single);
    let err = "";
    try {
      const code = await soloCommand([], {
        env: { SHOP_DB_URL: WITNESS },
        cwd: root,
        stdout: { write: () => true },
        stderr: { write: (text) => (err += text) },
        runner: new FakeRunner(root, { npm: 127 }),
      });
      assert.equal(code, 4);
      assert.match(err, /the run targets the environment local\./);
    } finally {
      await server.close();
    }
  });

  it("journals a state that cannot be written, and exits with 5", async () => {
    const server = await scriptedServer([]);
    const root = repository(configText(server.baseUrl));
    // A folder where the state goes: the state cannot be written there.
    mkdirSync(join(root, ".oqas", "runs", `${FIRST_RUN}.json`), { recursive: true });
    let err = "";
    try {
      const code = await soloCommand(["--environment", "local"], {
        env: { SHOP_DB_URL: WITNESS },
        cwd: root,
        stdout: { write: () => true },
        stderr: { write: (text) => (err += text) },
        runner: new FakeRunner(root),
        connect: () => Promise.reject(new Error("no runtime")),
        now: later(12),
      });
      assert.equal(code, 5);
      assert.match(err, /\[summary\] error: The summary stopped on an unexpected error: EISDIR/);
      assert.match(err, /oqas stopped on an unexpected error: EISDIR/);
      assert.match(journalOf(root).at(-1)!.message, /The summary did not succeed\./);
    } finally {
      await server.close();
    }
  });

  it("exits with 5 when its error output closes, and says why on it as long as it can", async () => {
    const server = await scriptedServer([]);
    const root = repository(configText(server.baseUrl));
    let err = "";
    try {
      // The lines of the summary are refused: the summary cannot even tell why it stopped.
      const code = await soloCommand(["--environment", "local"], {
        env: { SHOP_DB_URL: WITNESS },
        cwd: root,
        stdout: { write: () => true },
        stderr: {
          write: (text) => {
            if (text.startsWith("[summary]")) throw new Error("the output is closed");
            err += text;
            return true;
          },
        },
        runner: new FakeRunner(root),
        connect: () => Promise.reject(new Error("no runtime")),
      });
      assert.equal(code, 5);
      assert.match(err, /oqas stopped on an unexpected error: the output is closed/);
    } finally {
      await server.close();
    }
  });
});
