import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { closedPort } from "@open-qa-stack/testing";
import { afterAll, beforeAll, describe, it } from "vitest";
import { ADDRESS_TIMEOUT_MS, EnvironmentAddresses } from "../src/index.ts";

/** A local server that answers 500 on /broken, never answers on /silent, and redirects elsewhere. */
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/silent") return;
    if (request.url === "/empty") {
      response.writeHead(204).end();
      return;
    }
    if (request.url === "/moved") {
      response.writeHead(302, { location: "http://127.0.0.1:1/nowhere" }).end();
      return;
    }
    response.writeHead(500).end("broken");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** A fetch that fails as the system does, with the code of the system in its cause, or none. */
const failing =
  (code?: string): typeof fetch =>
  () =>
    Promise.reject(new TypeError("fetch failed", { cause: code === undefined ? new Error("socket closed") : Object.assign(new Error(code), { code }) }));

describe("the test of an address of an environment", () => {
  it("criterion 1 — says an address that answers 500 answers, its status given, and follows no redirection", async () => {
    const addresses = new EnvironmentAddresses();
    assert.deepEqual(await addresses.check(`${base}/broken`), { state: "answers", url: `${base}/broken`, status: 500 });
    assert.deepEqual(await addresses.check(` ${base}/moved `), { state: "answers", url: `${base}/moved`, status: 302 });
    assert.deepEqual(await addresses.check(`${base}/empty`), { state: "answers", url: `${base}/empty`, status: 204 });
  });

  it("criterion 2 — gives a reason of its own, naming the address, to a timeout, an unknown name, a refused connection and an address that is none", async () => {
    const refused = `http://127.0.0.1:${await closedPort()}/`;
    assert.deepEqual(await new EnvironmentAddresses().check(refused), { state: "refused", url: refused });
    assert.deepEqual(await new EnvironmentAddresses({ timeoutMs: 100 }).check(`${base}/silent`), { state: "timeout", url: `${base}/silent` });
    const unknown = new EnvironmentAddresses({ fetch: failing("ENOTFOUND") });
    assert.deepEqual(await unknown.check("https://shop.example.invalid/"), { state: "unknown-host", url: "https://shop.example.invalid/" });
    assert.deepEqual(await new EnvironmentAddresses({ fetch: failing("EAI_AGAIN") }).check("https://a.test/"), {
      state: "unknown-host",
      url: "https://a.test/",
    });
    for (const typed of ["shop", "ftp://shop.test/", "http://", ""])
      assert.deepEqual(await new EnvironmentAddresses().check(typed), { state: "malformed", url: typed }, typed);
  });

  it("names the code of another failure of the connection when the system tells one, and none otherwise", async () => {
    assert.deepEqual(await new EnvironmentAddresses({ fetch: failing("ECONNRESET") }).check("https://a.test/"), {
      state: "unreachable",
      url: "https://a.test/",
      code: "ECONNRESET",
    });
    assert.deepEqual(await new EnvironmentAddresses({ fetch: failing() }).check("https://a.test/"), { state: "unreachable", url: "https://a.test/" });
    assert.deepEqual(await new EnvironmentAddresses({ fetch: () => Promise.reject(new Error("no cause")) }).check("https://a.test/"), {
      state: "unreachable",
      url: "https://a.test/",
    });
  });

  it("says no secret: the name and the password of an address are not said back", async () => {
    const check = await new EnvironmentAddresses({ fetch: failing("ENOTFOUND") }).check("https://clerk:s3cret@shop.test/login");
    assert.deepEqual(check, { state: "unknown-host", url: "https://shop.test/login" });
    assert.doesNotMatch(JSON.stringify(check), /s3cret|clerk/);
  });

  it("gives an address ten seconds to answer by default", () => {
    assert.equal(ADDRESS_TIMEOUT_MS, 10_000);
  });
});
