import type { DomainSetting, DomainSettingStorePort } from "@open-qa-stack/domain";

/** What a person set of the domains, kept in memory. */
export class MemoryDomainSettingStore implements DomainSettingStorePort {
  readonly #settings = new Map<string, DomainSetting>();
  /** Why the store refuses to forget, when a test makes it refuse. */
  refusal: Error | undefined;

  list(): Promise<DomainSetting[]> {
    return Promise.resolve([...this.#settings.values()]);
  }

  set(setting: DomainSetting): Promise<void> {
    this.#settings.set(setting.id, setting);
    return Promise.resolve();
  }

  remove(ids: readonly string[]): Promise<void> {
    if (this.refusal !== undefined) return Promise.reject(this.refusal);
    for (const id of ids) this.#settings.delete(id);
    return Promise.resolve();
  }
}
