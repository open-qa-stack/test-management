import type { Memory, MemoryContent, MemoryFilter, MemoryOrigin, MemoryStorePort } from "@open-qa-stack/domain";

/** The memories of the agents kept in memory, by the rule of the port: what their tools are tested on, without a database. */
export class KeptMemories implements MemoryStorePort {
  readonly #memories: Memory[] = [];

  /** @param memories - Those kept from the start, in the order they were written. */
  constructor(memories: readonly Memory[] = []) {
    this.#memories.push(...memories);
  }

  list({ domain, kind, source }: MemoryFilter): Promise<Memory[]> {
    return Promise.resolve(
      this.#memories.filter(
        (memory) =>
          (domain === undefined || memory.domain === domain) &&
          (kind === undefined || memory.kind === kind) &&
          (source === undefined || memory.source === source),
      ),
    );
  }

  add(memory: Memory): Promise<void> {
    this.#memories.push(memory);
    return Promise.resolve();
  }

  revise(id: string, { text, tags, source }: MemoryContent, revised: MemoryOrigin): Promise<boolean> {
    const at = this.#memories.findIndex((memory) => memory.id === id);
    if (at === -1) return Promise.resolve(false);
    const { source: _, ...kept } = this.#memories[at]!;
    this.#memories[at] = { ...kept, text, tags, ...(source === undefined ? {} : { source }), revised };
    return Promise.resolve(true);
  }
}
