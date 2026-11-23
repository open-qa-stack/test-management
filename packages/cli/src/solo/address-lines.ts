import type { AddressCheck } from "@open-qa-stack/domain";

/** An address of an environment of an application, and what its test found. */
export interface CheckedAddress {
  /** The identifier of the application. */
  readonly application: string;
  /** The name of the environment. */
  readonly environment: string;
  /** What the address is: `interface`, or the name of an API. */
  readonly address: string;
  readonly check: AddressCheck;
}

/** Why an address does not answer, in words that say what to correct. */
const WHY: Readonly<Record<Exclude<AddressCheck["state"], "answers" | "unreachable">, string>> = {
  malformed: "is no http or https address: check how it is written",
  "unknown-host": "names no machine: check the name, often a typo",
  refused: "is refused: nothing listens on that port, check the port and that the application runs",
  timeout: "does not answer within ten seconds: check that the application runs and can be reached from here",
};

/**
 * @param checked - An address, and what its test found.
 * @returns The line `oqas applications check` prints of it.
 */
export function addressLine({ application, environment, address, check }: CheckedAddress): string {
  const where = `${application} › ${environment} › ${address}  ${check.url}`;
  if (check.state === "answers") return `${where}  answers, ${check.status}`;
  if (check.state === "unreachable")
    return `${where}  cannot be reached${check.code === undefined ? "" : ` (${check.code})`}: check the address and the network`;
  return `${where}  ${WHY[check.state]}`;
}
