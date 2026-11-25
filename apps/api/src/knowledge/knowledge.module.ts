import { Module } from "@nestjs/common";
import { Configuration, KnowledgeDocuments, KnowledgeDomains, KnowledgeMapping, KnowledgeSources, Secrets } from "@open-qa-stack/engine";
import { ConfigurationStore, DocumentStore, DomainSettingStore, SessionStore } from "@open-qa-stack/store";
import { ApiConfiguration } from "../config/api-configuration.ts";
import { DatabaseModule } from "../database/database.module.ts";
import { RepositoryConfigurationModule } from "../repository-configuration/repository-configuration.module.ts";
import { DomainsController } from "./domains.controller.ts";
import { KnowledgeController } from "./knowledge.controller.ts";
import { MappingController } from "./mapping.controller.ts";
import { SourcesController } from "./sources.controller.ts";

/**
 * The routes of the documents of the knowledge sources of the instance, over the operations of the engine: they keep
 * the documents in the database of the instance, for the sources the configuration in force declares stored. The
 * routes hold no rule of the documents: each calls one operation. A source is tested with the environment the runs read.
 */
@Module({
  imports: [DatabaseModule, RepositoryConfigurationModule],
  controllers: [DomainsController, KnowledgeController, MappingController, SourcesController],
  providers: [
    {
      provide: KnowledgeDocuments,
      inject: [DocumentStore, ConfigurationStore],
      useFactory: (documents: DocumentStore, configuration: ConfigurationStore) => new KnowledgeDocuments(documents, configuration),
    },
    {
      provide: KnowledgeDomains,
      inject: [ApiConfiguration, ConfigurationStore, DomainSettingStore],
      useFactory: ({ repository }: ApiConfiguration, configuration: ConfigurationStore, settings: DomainSettingStore) =>
        new KnowledgeDomains(repository, configuration, settings),
    },
    {
      provide: KnowledgeMapping,
      inject: [ApiConfiguration, Configuration, SessionStore],
      useFactory: ({ repository }: ApiConfiguration, configuration: Configuration, sessions: SessionStore) =>
        new KnowledgeMapping(repository, configuration, sessions),
    },
    {
      provide: KnowledgeSources,
      inject: [ApiConfiguration, Secrets, DocumentStore],
      useFactory: ({ repository }: ApiConfiguration, secrets: Secrets, documents: DocumentStore) => new KnowledgeSources(repository, secrets, documents),
    },
  ],
})
export class KnowledgeModule {}
