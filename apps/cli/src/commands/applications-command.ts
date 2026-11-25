import { ExitCode, type ExitCodeValue } from "@open-qa-stack/domain";
import type { Configuration, EnvironmentAddresses } from "@open-qa-stack/engine";
import { UsageError } from "../errors/usage-error.ts";
import { addressLine, type CheckedAddress } from "../output/address-lines.ts";
import type { Asked } from "./asked.ts";
import { print } from "./print.ts";

/**
 * `oqas applications check`: tests that each address of the environments of the applications of the configuration in
 * force answers — that of the interface, those of the APIs —, or of the one named, without the model and writing
 * nothing. Exits with `0` when each answers, with `4` otherwise.
 */
export async function addressesChecked({
  configuration,
  addresses,
  command,
  options,
  io,
}: Pick<Asked<"applications">, "command" | "options" | "io"> & { configuration: Configuration; addresses: EnvironmentAddresses }): Promise<ExitCodeValue> {
  const declared = (await configuration.current()).document.applications;
  const asked = command.application === undefined ? declared : declared.filter(({ id }) => id === command.application);
  // A configuration declares one application at least: only an application named may be missing.
  if (asked.length === 0) throw new UsageError(`The configuration in force declares no application ${command.application!}; oqas project names them.`);
  const named = asked.flatMap(({ id, environments }) =>
    environments.flatMap(({ name, uiUrl, apis = [] }) => [
      ...(uiUrl === undefined ? [] : [{ application: id, environment: name, address: "interface", url: uiUrl }]),
      ...apis.map((api) => ({ application: id, environment: name, address: api.name, url: api.baseUrl })),
    ]),
  );
  if (named.length === 0) throw new UsageError("The environments of the applications declare no address to test.");
  const checks: CheckedAddress[] = await Promise.all(named.map(async ({ url, ...where }) => ({ ...where, check: await addresses.check(url) })));
  print({ options, io }, checks.map(addressLine).join("\n"), { checks });
  return checks.every(({ check }) => check.state === "answers") ? ExitCode.passed : ExitCode.prerequisite;
}
