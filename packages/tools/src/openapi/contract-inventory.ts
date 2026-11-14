import type { SourceInventory } from "../common/source-inventory.ts";
import { contractExport, operationName } from "./contract-export.ts";
import type { OpenApiContract } from "./openapi-contract.ts";

/**
 * Reads what a contract holds, without the model.
 *
 * @remarks
 * The elements are its operations, each as `METHOD /path`, with its identifier and its tags as facts when it
 * has some; its schemas are elements of its export only. The fingerprint is that of the export.
 *
 * @param contract - The contract.
 * @returns The inventory of the contract, with its export.
 * @throws Error when the contract cannot be loaded.
 */
export async function contractInventory(contract: OpenApiContract): Promise<SourceInventory> {
  const exported = contractExport(await contract.definitions());
  const facts = new Map(
    (await contract.operations()).map(({ method, path, operationId, tags }) => [
      operationName(method, path),
      { kind: "operation", ...(operationId === undefined ? {} : { operationId }), ...(tags === undefined ? {} : { tags }) },
    ]),
  );
  return { items: [...facts.keys()], facts, fingerprint: exported.fingerprint, export: exported };
}
