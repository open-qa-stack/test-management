import { Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Post, Req } from "@nestjs/common";
import { KnowledgeDocuments } from "@open-qa-stack/engine";
import { receivedFiles } from "./received-files.ts";
import type { FastifyRequest } from "fastify";
import type { DocumentList, StoredDocument } from "@open-qa-stack/domain/sessions";

/**
 * `GET /knowledge/:source/documents`, `POST /knowledge/:source/documents`, `GET /knowledge/:source/documents/:name`
 * and `DELETE /knowledge/:source/documents/:name`: each route is one operation on the documents of a knowledge
 * source, said in HTTP.
 */
@Controller("knowledge/:source/documents")
export class KnowledgeController {
  readonly #documents: KnowledgeDocuments;

  constructor(documents: KnowledgeDocuments) {
    this.#documents = documents;
  }

  /** @returns The documents of the source without their texts, in the order of their names, which no cache may keep. */
  @Get()
  @Header("Cache-Control", "no-store")
  async list(@Param("source") source: string): Promise<DocumentList> {
    return { items: await this.#documents.list(source) };
  }

  /**
   * Uploads the files of a multipart request as documents of the source, all of them or none.
   *
   * @returns The documents of the source as they are now, answered with `201`; an upload that breaks a rule of the
   * documents is answered with `422`, and a source the configuration in force does not declare stored with `404`.
   */
  @Post()
  async upload(@Param("source") source: string, @Req() request: FastifyRequest): Promise<DocumentList> {
    await this.#documents.upload(source, await receivedFiles(request));
    return this.list(source);
  }

  /** @returns The document, with its text, which no cache may keep. */
  @Get(":name")
  @Header("Cache-Control", "no-store")
  read(@Param("source") source: string, @Param("name") name: string): Promise<StoredDocument> {
    return this.#documents.read(source, name);
  }

  /** Removes the document, answered with `204`. */
  @Delete(":name")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("source") source: string, @Param("name") name: string): Promise<void> {
    return this.#documents.remove(source, name);
  }
}
