/** A source that holds part of a domain of the knowledge, with the applications it describes. */
export interface KnowledgeDomainSource {
  /** Its identifier: that of a knowledge source, or of the application whose user interface it is. */
  readonly id: string;
  /** The applications it describes; none for a source of the whole project. */
  readonly applications: readonly string[];
  /** What the cartography placed of it in the domain: tables, screens, sections, operations or folders. */
  readonly items: readonly string[];
}

/** A domain of the knowledge of the project, as the cartography named it: what a session may keep its work to. */
export interface KnowledgeDomain {
  /** Its identifier, which a scope names it by. */
  readonly id: string;
  readonly label: string;
  /** The name the cartography gave it, when a person gave it another, which `label` then is. */
  readonly foundLabel?: string;
  /** Set for a domain a person excluded: it is proposed to no session, and served to no agent. */
  readonly excluded?: true;
  readonly description: string;
  /** The sources that hold it, in the order of the index. */
  readonly sources: readonly KnowledgeDomainSource[];
}

/** The domains of the knowledge of the project, as `GET /knowledge/domains` answers. */
export interface KnowledgeDomainList {
  /** None until the cartography mapped the knowledge. */
  readonly items: readonly KnowledgeDomain[];
}
