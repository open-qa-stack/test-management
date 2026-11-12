import dgram from "node:dgram";
import dns from "node:dns";
import net from "node:net";

/** Loaded before every test file: any network access during the tests fails loudly. */
export class NetworkAccessError extends Error {
  constructor(what: string) {
    super(`network access attempted during tests: ${what}`);
  }
}

function refuse(what: string): () => never {
  return () => {
    throw new NetworkAccessError(what);
  };
}

const RESOLVERS = ["resolve", "resolve4", "resolve6", "resolveAny", "resolveCname", "resolveMx", "resolveNs", "resolveSrv", "resolveTxt", "reverse"] as const;

/** Every network entry point the tests refuse, by name. */
export const BLOCKED: Record<string, () => unknown> = {};

function block(target: object, name: string, label: string): void {
  const stub = refuse(label);
  Object.defineProperty(target, name, { value: stub, configurable: true, writable: true });
  BLOCKED[label] = stub;
}

block(net.Socket.prototype, "connect", "net.Socket#connect");
block(dgram.Socket.prototype, "send", "dgram.Socket#send");
block(dgram.Socket.prototype, "bind", "dgram.Socket#bind");
block(dns, "lookup", "dns.lookup");
block(dns.promises, "lookup", "dns.promises.lookup");
for (const name of RESOLVERS) {
  block(dns, name, `dns.${name}`);
  block(dns.promises, name, `dns.promises.${name}`);
  block(dns.Resolver.prototype, name, `dns.Resolver#${name}`);
  block(dns.promises.Resolver.prototype, name, `dns.promises.Resolver#${name}`);
}
block(globalThis, "fetch", "fetch");
