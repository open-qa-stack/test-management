import type { SourceInventory } from "../common/source-inventory.ts";
import type { OpenApiContract } from "./openapi-contract.ts";

/**
 * Reads what a contract holds, without the model.
 *
 * @remarks
 * The elements are its tags, and the first path segment of each operation without tag. The facts of each
 * are its operations, as `METHOD /path`. The fingerprint covers the whole document.
 *
 * @param contract - The contract.
 * @returns The inventory of the contract.
 * @throws Error when the contract cannot be loaded.
 */
export async function contractInventory(contract: OpenApiContract): Promise<SourceInventory> {
  const operations = new Map<string, string[]>();
  for (const operation of await contract.operations()) {
    for (const item of operation.tags ?? [`/${operation.path.split("/")[1]}`]) {
      operations.set(item, [...(operations.get(item) ?? []), `${operation.method} ${operation.path}`]);
    }
  }
  return { items: [...operations.keys()], facts: new Map([...operations].map(([item, list]) => [item, { operations: list }])), fingerprint: await contract.fingerprint() };
}
