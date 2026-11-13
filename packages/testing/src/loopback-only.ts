import dgram from "node:dgram";
import dns from "node:dns";
import net from "node:net";

// Loaded before every test file. The tests talk to the model gateway and to scripted model servers over
// the loopback interface only; any other connection, and any connection to the port of a local model
// server, fails.

import { MODEL_SERVER_PORT, NetworkAccessError } from "./network-access-error.ts";
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
// oxlint-disable-next-line typescript/unbound-method -- the original method, applied to each socket the guard lets through
const connect = net.Socket.prototype.connect;

function target(args: unknown[]): { host: string; port: number } {
  // `net.connect` hands the socket its arguments already normalised, as one array.
  const [first, second] = Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
  if (typeof first === "object" && first !== null) {
    const options = first as { host?: string; port?: number | string; path?: string };
    if (options.path !== undefined) return { host: "localhost", port: 0 };
    return { host: options.host ?? "localhost", port: Number(options.port) };
  }
  return { host: typeof second === "string" ? second : "localhost", port: Number(first) };
}

net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
  const { host, port } = target(args);
  if (!LOOPBACK.has(host) || port === MODEL_SERVER_PORT) {
    throw new NetworkAccessError(`network access refused during tests: ${host}:${port}`);
  }
  return (connect as (...a: unknown[]) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;

function refuse(what: string): () => never {
  return () => {
    throw new NetworkAccessError(`network access refused during tests: ${what}`);
  };
}
for (const name of ["resolve", "resolve4", "resolve6", "resolveAny"] as const) {
  Object.defineProperty(dns, name, { value: refuse(`dns.${name}`), configurable: true, writable: true });
  Object.defineProperty(dns.promises, name, { value: refuse(`dns.promises.${name}`), configurable: true, writable: true });
}

/** Name lookups are allowed for the loopback interface only. */
function loopbackLookup<F extends (hostname: string, ...rest: never[]) => unknown>(lookup: F, what: string): F {
  return function guardedLookup(hostname: string, ...rest: never[]) {
    if (!LOOPBACK.has(hostname)) throw new NetworkAccessError(`network access refused during tests: ${what} ${hostname}`);
    return lookup(hostname, ...rest);
  } as F;
}
Object.defineProperty(dns, "lookup", { value: loopbackLookup(dns.lookup, "dns.lookup"), configurable: true, writable: true });
Object.defineProperty(dns.promises, "lookup", {
  value: loopbackLookup(dns.promises.lookup, "dns.promises.lookup"),
  configurable: true,
  writable: true,
});
Object.defineProperty(dgram.Socket.prototype, "send", { value: refuse("dgram send"), configurable: true, writable: true });
