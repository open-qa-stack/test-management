// Runs the tool-calling check against a real model server and writes the recording.
// Usage: node scripts/record-tool-calling.ts --model <id> --server "<name and version>" --out <file>
//        [--base-url http://localhost:1234/v1] [--api-key-env NAME]
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { recordToolCallingCheck, serializeRecording } from "../src/index.ts";

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    server: { type: "string" },
    out: { type: "string" },
    "base-url": { type: "string", default: "http://localhost:1234/v1" },
    "api-key-env": { type: "string" },
  },
});
const { model, server, out } = values;
if (model === undefined || server === undefined || out === undefined) throw new Error("--model, --server and --out are required.");
const keyEnv = values["api-key-env"];
const apiKey = keyEnv === undefined ? undefined : process.env[keyEnv];

const homeDirectory = mkdtempSync(join(tmpdir(), "oqas-copilot-"));
try {
  const result = await recordToolCallingCheck({
    upstream: { baseUrl: values["base-url"], ...(apiKey === undefined ? {} : { apiKey }) },
    model,
    server,
    recordedOn: new Date().toISOString().slice(0, 10),
    homeDirectory,
  });
  for (const event of result.events) console.log(JSON.stringify(event));
  console.log(JSON.stringify({ verdict: result.verdict }));
  writeFileSync(out, serializeRecording(result.recording));
} finally {
  rmSync(homeDirectory, { recursive: true, force: true });
}
