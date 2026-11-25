import type { ExitCodeValue } from "@open-qa-stack/domain";
import { playwrightVersion } from "@open-qa-stack/tools";
import type { Arguments } from "../arguments/arguments.ts";
import { RepositoryInit } from "../project/repository-init.ts";
import { addressesChecked } from "./applications-command.ts";
import { campaigned } from "./campaigns-command.ts";
import type { CommandIo } from "./command-io.ts";
import { configured, fileChecked, historied } from "./config-command.ts";
import { executed } from "./executions-command.ts";
import { checked, documented, domainChanged, domained, known, mapped } from "./knowledge-command.ts";
import { launched } from "./launch-command.ts";
import { modelled } from "./model-command.ts";
import type { Operations } from "./operations.ts";
import type { PrintingCommand } from "./printing-command.ts";
import { projected, stood } from "./project-commands.ts";
import { valued } from "./secrets-command.ts";
import { listed, shown, stopped } from "./session-commands.ts";
import { tested } from "./tests-command.ts";

/**
 * Runs a command that prints, on operations already open: the command opens them for it alone, the conversation
 * hands it those it holds.
 *
 * @param operations - The operations of the test repository.
 * @param repository - Absolute path of the test repository.
 * @param command - What the arguments ask for.
 * @param options - How to print.
 * @param io - Where to write, and what a value is read from.
 * @returns The exit code of the command.
 */
export async function runPrinting(
  operations: Operations,
  repository: string,
  command: PrintingCommand,
  options: Arguments,
  io: CommandIo,
): Promise<ExitCodeValue> {
  const { sessions, configuration, documents, secrets, sources, mapping, addresses } = operations;
  switch (command.name) {
    case "init":
      return await new RepositoryInit({
        repositoryRoot: repository,
        configuration,
        playwrightVersion: playwrightVersion(),
        write: (line) => io.stderr.write(line),
        print: (line) => io.stdout.write(line),
      }).run();
    case "config":
      if (command.action === "history") return historied(await configuration.revisions(), { options, io });
      if (command.action === "check") return await fileChecked(configuration, repository, { options, io });
      return await configured({ configuration, command, options, io });
    case "project":
      return projected(await sessions.project(), { options, io });
    case "repository":
      return stood(await operations.setup.state(), { options, io });
    case "applications":
      return await addressesChecked({ configuration, addresses, command, options, io });
    case "knowledge":
      if (command.action === "check") return await checked({ configuration, sources, command, options, io });
      if (command.action === "mapping") return mapped(await mapping.state(), options, io);
      if (command.action === "domain") return await domainChanged(operations, command, { options, io });
      if (command.action === "domains") return await domained(operations, { options, io });
      if (command.action === "read" || command.action === "remove") return await documented(documents, command, { options, io });
      return await known({ configuration, documents, command, options, io });
    case "model":
      return await modelled({ configuration, secrets, command, options, io });
    case "secrets":
      return await valued({ secrets, command, options, io });
    case "sessions":
      return await listed({ sessions, command, options, io });
    case "show":
      return await shown({ sessions, command, options, io });
    case "stop":
      return await stopped({ sessions, command, options, io });
    case "tests":
      // The tests are read with the configuration of oqas.json, which says where the applications and the runs are.
      await configuration.inForce();
      return await tested(operations, command, { options, io });
    case "executions":
      return await executed(operations, command, { options, io });
    case "launch":
      return await launched(operations, command, { options, io });
    case "campaigns":
      // The tests of a campaign are read with the configuration of oqas.json, as those of oqas tests are.
      await configuration.inForce();
      return await campaigned(operations, command, { options, io });
  }
}
