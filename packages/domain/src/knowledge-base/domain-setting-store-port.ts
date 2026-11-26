import type { DomainSetting } from "./domain-setting.ts";

/** The port of the store of what a person set of the domains of the knowledge: what the operations ask of what keeps it. */
export interface DomainSettingStorePort {
  /** @returns What was set of each domain, in the order of their identifiers. */
  list(): Promise<DomainSetting[]>;

  /** Keeps what was set of a domain, in place of what was before. */
  set(setting: DomainSetting): Promise<void>;

  /** Forgets what was set of the domains of these identifiers. */
  remove(ids: readonly string[]): Promise<void>;
}
