import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { TEST_ENVIRONMENT } from "./environment.ts";
import { PostgresContainer } from "./postgres-container.ts";

// Runs the command it is given with `OQAS_TEST_DATABASE_URL` set: to the server already named by that
// variable, or else to a disposable server started for the run. `SIGINT` and `SIGTERM` are passed on to
// the command; whatever way the command ends, every container the run started is then removed.

const [command, ...args] = process.argv.slice(2);
if (command === undefined) throw new Error("usage: with-test-database <command> [arguments…]");

const testRun = randomBytes(6).toString("hex");
let child: ChildProcess | undefined;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    interrupted = true;
    child?.kill(signal);
  });
}

const given = TEST_ENVIRONMENT["OQAS_TEST_DATABASE_URL"];
try {
  const container = given === undefined || given === "" ? await PostgresContainer.start(testRun) : undefined;
  if (interrupted) process.exitCode = 130;
  else {
    child = spawn(command, args, { stdio: "inherit", env: { ...TEST_ENVIRONMENT, OQAS_TEST_RUN: testRun, OQAS_TEST_DATABASE_URL: container?.url ?? given } });
    const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
    process.exitCode = code ?? (signal === null ? 1 : 128);
  }
} finally {
  await PostgresContainer.removeRun(testRun);
}
