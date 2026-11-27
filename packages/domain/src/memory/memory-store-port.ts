import type { Memory, MemoryContent, MemoryFilter, MemoryOrigin } from "./memory.ts";

/** The port of the store of the memories of the agents: what their tools ask of what keeps them, whatever keeps them. */
export interface MemoryStorePort {
  /**
   * @param filter - Which memories: those of a domain, of a kind, of a source, or of several of them at once.
   * @returns The memories that equal every filter given, in the order they were written.
   */
  list(filter: MemoryFilter): Promise<Memory[]>;

  /** Keeps a memory just written, under an identifier no other one has. */
  add(memory: Memory): Promise<void>;

  /**
   * Corrects what a memory says; its identifier, its domain, its kind and who wrote it stay.
   *
   * @param id - The identifier of the memory.
   * @param content - What it says now.
   * @param revised - Who corrected it, and when.
   * @returns Whether a memory of that identifier was kept, and so corrected.
   */
  revise(id: string, content: MemoryContent, revised: MemoryOrigin): Promise<boolean>;

  /**
   * Sets a memory aside, or takes it back: the agents recall a memory set aside no more.
   *
   * @param id - The identifier of the memory.
   * @param enabled - Whether the agents recall it.
   * @returns Whether a memory of that identifier was kept, and so changed.
   */
  enable(id: string, enabled: boolean): Promise<boolean>;
}
