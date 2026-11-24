#!/usr/bin/env node
import { soloCommand } from "./solo/solo-command.ts";

const code = await soloCommand(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr,
  input: process.stdin,
  ...(process.stdin.isTTY && process.stdout.isTTY ? { terminal: { stdin: process.stdin, stdout: process.stdout } } : {}),
  onInterrupt: (listener) => {
    process.on("SIGINT", listener);
    return () => process.off("SIGINT", listener);
  },
});
// What a session that was left still does — a call to the model, a child that ends — must not hold the terminal: the outputs are flushed, then the process exits.
process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
