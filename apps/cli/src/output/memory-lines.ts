import type { MemoryItem } from "@open-qa-stack/domain";

/** How each type of line of the memory is told. */
const TYPES = { instruction: "instruction", correction: "correction", inferred: "noted by an agent" } as const;

/** @returns The line of the memory: its identifier, whether it applies, its type, where and for what, then what it says. */
export function memoryLine(item: MemoryItem): string {
  const where = item.filed === undefined ? (item.application ?? "project") : `${item.filed.domain}, ${item.filed.kind}, by the ${item.filed.role}`;
  return `${item.id}  ${item.active ? "active" : "set aside"}  ${TYPES[item.type]}  (${where}; ${item.target})  ${item.text}`;
}
