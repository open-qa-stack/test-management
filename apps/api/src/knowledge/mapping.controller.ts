import { Controller, Get, Header } from "@nestjs/common";
import { KnowledgeMapping } from "@open-qa-stack/engine";
import type { CartographyState } from "@open-qa-stack/domain/sessions";

/** `GET /knowledge/mapping`: where the cartography of the knowledge stands, source by source, said in HTTP. */
@Controller("knowledge/mapping")
export class MappingController {
  readonly #mapping: KnowledgeMapping;

  constructor(mapping: KnowledgeMapping) {
    this.#mapping = mapping;
  }

  /** @returns Each source the cartography reads and where its cartography stands, with the knowledge base, which no cache may keep. */
  @Get()
  @Header("Cache-Control", "no-store")
  state(): Promise<CartographyState> {
    return this.#mapping.state();
  }
}
