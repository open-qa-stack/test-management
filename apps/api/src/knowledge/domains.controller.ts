import { Controller, Get, Header } from "@nestjs/common";
import { KnowledgeDomains } from "@open-qa-stack/engine";
import type { KnowledgeDomainList } from "@open-qa-stack/domain/sessions";

/** `GET /knowledge/domains`: the domains of the knowledge of the project, which a session may keep its work to. */
@Controller("knowledge/domains")
export class DomainsController {
  readonly #domains: KnowledgeDomains;

  constructor(domains: KnowledgeDomains) {
    this.#domains = domains;
  }

  /** @returns The domains the last cartography named, as the items of a list which no cache may keep; none before it. */
  @Get()
  @Header("Cache-Control", "no-store")
  async list(): Promise<KnowledgeDomainList> {
    return { items: await this.#domains.list() };
  }
}
