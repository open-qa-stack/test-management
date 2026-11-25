import { Body, Controller, Get, Header, Param, Patch } from "@nestjs/common";
import { KnowledgeDomains } from "@open-qa-stack/engine";
import { DomainChangePipe } from "./domain-change.pipe.ts";
import type { DomainChange, KnowledgeDomain, KnowledgeDomainList } from "@open-qa-stack/domain/sessions";

/** `GET /knowledge/domains` and `PATCH /knowledge/domains/:id`: the domains of the knowledge of the project, which a session may keep its work to. */
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

  /** @returns The domain, its name changed, excluded or taken back. */
  @Patch(":id")
  @Header("Cache-Control", "no-store")
  change(@Param("id") id: string, @Body(DomainChangePipe) change: DomainChange): Promise<KnowledgeDomain> {
    return this.#domains.change(id, change);
  }
}
