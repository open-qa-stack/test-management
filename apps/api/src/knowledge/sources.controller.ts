import { Body, Controller, Header, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { KnowledgeSources } from "@open-qa-stack/engine";
import { SourceBodyPipe, type SourceTest } from "./source-body.pipe.ts";
import type { SourceCheck } from "@open-qa-stack/domain/sessions";

/** `POST /knowledge/check`: the test of a knowledge source as the person drafts it, said in HTTP. */
@Controller("knowledge/check")
export class SourcesController {
  readonly #sources: KnowledgeSources;

  constructor(sources: KnowledgeSources) {
    this.#sources = sources;
  }

  /**
   * Tests that a knowledge source answers, before anything is saved or indexed.
   *
   * @returns What the test found, answered with `200`; a body that is no source the configuration accepts is answered
   * with `400`, and an API that was given no test repository with `503`.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  check(@Body(SourceBodyPipe) { source, value }: SourceTest): Promise<SourceCheck> {
    return this.#sources.check(source, value);
  }
}
