/** A domain of the knowledge of the project, as the cartography named it: what a session may keep its work to. */
export interface KnowledgeDomain {
  /** Its identifier, which a scope names it by. */
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

/** The domains of the knowledge of the project, as `GET /knowledge/domains` answers. */
export interface KnowledgeDomainList {
  /** None until the cartography mapped the knowledge. */
  readonly items: readonly KnowledgeDomain[];
}
