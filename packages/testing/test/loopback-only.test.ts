import assert from "node:assert/strict";
import dgram from "node:dgram";
import dns from "node:dns";
import { once } from "node:events";
import net from "node:net";
import { describe, it } from "node:test";

import "../src/loopback-only.ts";
import { closedPort, MODEL_SERVER_PORT, NetworkAccessError } from "../src/index.ts";

/** Resolves once the socket has failed to reach a closed port or a missing file. */
async function refusedByThePeer(socket: net.Socket): Promise<void> {
  const [error] = (await once(socket, "error")) as [NodeJS.ErrnoException];
  assert.match(error.code ?? "", /^(ECONNREFUSED|ENOENT)$/);
}

describe("the loopback guard", () => {
  it("refuses a connection to another host, whichever way the socket is given it", () => {
    assert.throws(() => net.connect(80, "192.0.2.1"), NetworkAccessError);
    assert.throws(() => new net.Socket().connect(80, "192.0.2.1"), NetworkAccessError);
    assert.throws(() => new net.Socket().connect({ port: 80, host: "192.0.2.1" }), NetworkAccessError);
  });

  it("refuses the port of a local model server, even on the loopback interface", () => {
    assert.throws(() => net.connect(MODEL_SERVER_PORT, "127.0.0.1"), /127\.0\.0\.1:1234/);
  });

  it("lets a connection through to the loopback interface, a host left out meaning localhost", async () => {
    const port = await closedPort();
    await refusedByThePeer(net.connect({ port }));
    await refusedByThePeer(new net.Socket().connect(port));
    await refusedByThePeer(net.connect(port, "::1"));
  });

  it("lets a connection through to a local socket file", async () => {
    await refusedByThePeer(net.connect({ path: "/nonexistent/loopback-guard.sock" }));
  });

  it("refuses name resolution, and lookups of any name but the loopback ones", async () => {
    assert.throws(() => dns.resolve4("example.com", () => undefined), /dns\.resolve4/);
    assert.throws(() => dns.promises.resolve("example.com"), /dns\.promises\.resolve/);
    assert.throws(() => dns.lookup("example.com", () => undefined), /dns\.lookup example\.com/);
    assert.throws(() => dns.promises.lookup("example.com"), /dns\.promises\.lookup example\.com/);
    assert.equal((await dns.promises.lookup("localhost")).address.length > 0, true);
  });

  it("refuses to send a datagram", () => {
    const socket = dgram.createSocket("udp4");
    assert.throws(() => socket.send("x", 53, "192.0.2.1"), /dgram send/);
    socket.close();
  });
});
