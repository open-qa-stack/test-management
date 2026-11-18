import { Module } from "@nestjs/common";
import { KnowledgeDocuments } from "@open-qa-stack/engine";
import { ConfigurationStore, DocumentStore } from "@open-qa-stack/store";
import { DatabaseModule } from "../database/database.module.ts";
import { KnowledgeController } from "./knowledge.controller.ts";

/**
 * The routes of the documents of the knowledge sources of the instance, over the operations of the engine: they keep
 * the documents in the database of the instance, for the sources the configuration in force declares stored. The
 * routes hold no rule of the documents: each calls one operation.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [KnowledgeController],
  providers: [
    {
      provide: KnowledgeDocuments,
      inject: [DocumentStore, ConfigurationStore],
      useFactory: (documents: DocumentStore, configuration: ConfigurationStore) => new KnowledgeDocuments(documents, configuration),
    },
  ],
})
export class KnowledgeModule {}
