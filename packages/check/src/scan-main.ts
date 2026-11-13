import { GitRepository } from "./git-repository.ts";
import { ScanCommand } from "./scan-command.ts";

const command = new ScanCommand(new GitRepository(process.cwd()), (line) => process.stdout.write(`${line}\n`));
process.exitCode = await command.run(process.argv.slice(2));
