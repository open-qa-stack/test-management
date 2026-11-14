import { ManifestCheck } from "./manifest-check.ts";

const violations = await (await ManifestCheck.of(process.cwd())).violations();
for (const violation of violations) process.stderr.write(`${violation}\n`);
process.exitCode = violations.length === 0 ? 0 : 1;
