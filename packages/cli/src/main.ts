#!/usr/bin/env node
import { soloCommand } from "./solo-command.ts";

process.exitCode = await soloCommand(process.argv.slice(2), { env: process.env, cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr });
