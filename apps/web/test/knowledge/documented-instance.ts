import type { StoredDocument, StoredDocumentSummary } from "@open-qa-stack/domain/sessions";
import type { Api, ApiAnswer } from "../built-console.ts";
import { ConfiguredInstance } from "../configuration/configured-instance.ts";

/** An answer of the API that carries a JSON body. */
const json = (body: unknown, status = 200): ApiAnswer => ({ status, body: JSON.stringify(body) });

/** The path of the documents of the source the instance keeps, in the configuration of the fixtures. */
const DOCUMENTS = "/api/knowledge/manuals/documents";

/**
 * The API of an instance whose configuration declares the documents of `manuals` stored, beside the configuration
 * and the sessions of a configured instance: it lists them, takes an upload, serves one and removes one.
 */
export class DocumentedInstance {
  /** The configuration and the sessions of the instance. */
  public readonly configured = new ConfiguredInstance();
  /** The documents of `manuals`, by name. */
  public readonly documents = new Map<string, StoredDocument>([
    ["quotes.md", { name: "quotes.md", bytes: 31, uploadedAt: "2026-11-18T09:00:00.000Z", text: "# Quotes\n\nA quote is priced.\n" }],
  ]);

  /** The documents, without their texts, in the order of their names. */
  #listed(): { readonly items: readonly StoredDocumentSummary[] } {
    return { items: [...this.documents.values()].map(({ text: _, ...summary }) => summary).sort((left, right) => left.name.localeCompare(right.name)) };
  }

  /** What the API answers. */
  public readonly api: Api = (request) => {
    const { path, method, body = "" } = request;
    if (!path.startsWith(DOCUMENTS)) return this.configured.api(request);
    if (path === DOCUMENTS && method === "GET") return json(this.#listed());
    if (path === DOCUMENTS) {
      for (const [, name, text] of body.matchAll(/filename="([^"]*)"\r\ncontent-type: [^\r]*\r\n\r\n([^]*?)\r\n--/gi))
        this.documents.set(name!, { name: name!, bytes: text!.length, uploadedAt: "2026-11-18T10:00:00.000Z", text: text! });
      return json(this.#listed(), 201);
    }
    const name = decodeURIComponent(path.slice(DOCUMENTS.length + 1));
    const document = this.documents.get(name);
    if (document === undefined)
      return { status: 404, contentType: "application/problem+json", body: JSON.stringify({ code: "unknown_document", status: 404, detail: "None." }) };
    if (method === "DELETE") {
      this.documents.delete(name);
      return { status: 204, body: "" };
    }
    return json(document);
  };
}
