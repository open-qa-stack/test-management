import { connect } from "node:net";

/**
 * The ports a closed port is taken from: below those a system gives a server that asks for any port, which start
 * at 32768 on Linux and at 49152 on macOS and Windows, and above those a browser refuses to reach.
 */
const FIRST = 20_000;
const COUNT = 10_000;

/** How far apart two processes of the tests start: more ports than one test file asks for. */
const STRIDE = 101;

/** The ports this process tries, in order: each process of the tests starts from a place of its own. */
function* candidates(): Generator<number, never> {
  for (let rank = process.pid * STRIDE; ; rank++) yield FIRST + (rank % COUNT);
}

const OWN = candidates();

/** Whether a loopback port refuses a connection: nothing listens on it. */
function refuses(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
  });
}

/**
 * Finds a loopback port nothing listens on.
 *
 * @remarks
 * A port a server was given by the system, then closed, is not one: the system gives it again to the next
 * server that asks for any port, in a test that runs beside this one.
 *
 * @param ports - The ports to try, in order; those of this process by default.
 * @returns The first of them nothing listens on, which no server that asks the system for a port is given.
 */
export async function closedPort(ports: Iterable<number> = OWN): Promise<number> {
  // The ports of this process are one sequence for all its calls: it is read on, never ended by a call.
  const tried = ports[Symbol.iterator]();
  for (let next = tried.next(); !next.done; next = tried.next()) if (await refuses(next.value)) return next.value;
  throw new Error("no port to try is closed");
}
