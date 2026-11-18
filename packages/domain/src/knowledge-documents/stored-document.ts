/** A document a knowledge source of the instance holds, as a listing gives it: without its text. */
export interface StoredDocumentSummary {
  /** Its file name, unique in its source. */
  readonly name: string;
  /** Its size, in bytes of UTF-8. */
  readonly bytes: number;
  /** When it was uploaded last, as an ISO 8601 date. */
  readonly uploadedAt: string;
}

/** A document a knowledge source of the instance holds, with its text. */
export interface StoredDocument extends StoredDocumentSummary {
  readonly text: string;
}

/** What is uploaded to a source: a document, by its file name, with its text; the store sizes and dates it. */
export interface DocumentEntry {
  readonly name: string;
  readonly text: string;
}

/** The documents of a knowledge source, as the API lists them. */
export interface DocumentList {
  /** Every document of the source, in the order of their names. */
  readonly items: readonly StoredDocumentSummary[];
}
