import type { ConfigError, ConfigurationView, OqasConfig, Problem, ProblemCode, RevisionChange, RevisionSummary } from "@open-qa-stack/domain/sessions";
import type { Api, ApiAnswer } from "../built-console.ts";
import { PlayedInstance } from "../played-instance.ts";
import { REVISIONS, VIEW } from "./configuration-fixture.ts";

/** The error the played instance finds in a configuration whose model has no name. */
export const UNNAMED_MODEL: ConfigError = { kind: "structure", path: "/model/model", rule: "empty-value", message: "Expected a non-empty value." };

/** An answer of the API that carries a JSON body. */
const json = (body: unknown, status = 200): ApiAnswer => ({ status, body: JSON.stringify(body) });

/** A problem, as the API answers one. */
function problem(code: ProblemCode, status: number, errors: readonly ConfigError[] = []): ApiAnswer {
  const body: Problem = {
    type: `/problems/${code}`,
    title: "A problem",
    status,
    detail: "The API says what went wrong.",
    code,
    ...(errors.length === 0 ? {} : { errors }),
  };
  return { status, contentType: "application/problem+json", body: JSON.stringify(body) };
}

/** The errors the played instance finds in a configuration: one, when its model has no name. */
const errorsOf = (document: OqasConfig): ConfigError[] => (document.model.model === undefined ? [UNNAMED_MODEL] : []);

/**
 * The API of an instance whose configuration a test changes as it goes, beside the sessions of a played instance:
 * it checks a draft, takes a change, which the file then differs from, and takes or writes the file.
 */
export class ConfiguredInstance {
  /** The sessions of the instance. */
  public readonly played = new PlayedInstance();
  /** The configuration as the API tells it now. */
  public view: ConfigurationView = VIEW;
  /** The revisions, the latest first. */
  public revisions: readonly RevisionSummary[] = REVISIONS;
  /** Whether the file differs from the revision in force. */
  public fileChanged = false;
  /** The changes the API took, in order. */
  public readonly saved: RevisionChange[] = [];
  /** The values the API saved for the variables of the configuration, by name. */
  public readonly values = new Map<string, string>();

  /** Records a revision of an origin, which becomes the one in force. */
  #record(document: OqasConfig, origin: RevisionSummary["origin"]): ConfigurationView {
    // A change saved writes no file, which then differs from it; a file taken holds it.
    const summary: RevisionSummary = {
      number: (this.revisions[0]?.number ?? 0) + 1,
      recordedAt: "2026-11-18T10:00:00.000Z",
      origin,
      fileDigest: `d${this.revisions.length}`,
    };
    this.revisions = [summary, ...this.revisions];
    this.fileChanged = origin !== "file";
    this.view = { revision: { ...summary, document }, file: this.fileChanged ? "changed" : "in_step" };
    return this.view;
  }

  /** What the API answers. */
  public readonly api: Api = (request) => {
    const { path, method, body } = request;
    // A test repository that is no git repository yet, which the setting up makes one.
    if (path === "/api/repository") return json({ folder: "/work/shop-tests", git: "none", playwright: false });
    if (path === "/api/repository/preparation") return json({ created: ["playwright.config.ts"], kept: [], committed: true });
    // Every address answers 200, but one that names a refused port.
    if (path === "/api/configuration/address-check") {
      const { address } = JSON.parse(body!) as { address: string };
      return json(address.includes(":1/") ? { state: "refused", url: address } : { state: "answers", url: address, status: 200 });
    }
    // Every source answers, and holds three items.
    if (path === "/api/knowledge/check") return json({ state: "ok", items: 3 });
    // The key of the model of the fixtures, which the person types: saved once typed, missing before.
    if (path === "/api/secrets")
      return json({
        secrets: [{ name: "MODEL_KEY", kind: "model_key", paths: ["/model/apiKeyEnv"], source: this.values.has("MODEL_KEY") ? "saved" : "missing" }],
      });
    if (path.startsWith("/api/secrets/")) {
      this.values.set(decodeURIComponent(path.slice("/api/secrets/".length)), (JSON.parse(body!) as { value: string }).value);
      return { status: 204, body: "" };
    }
    if (!path.startsWith("/api/configuration")) return this.played.api(request);
    if (path === "/api/configuration") return json({ ...this.view, file: this.fileChanged ? "changed" : this.view.file });
    if (path === "/api/configuration/revisions" && method === "GET") return json({ items: this.revisions });
    if (path === "/api/configuration/validation") return json({ errors: errorsOf(JSON.parse(body!) as OqasConfig) });
    if (path === "/api/configuration/model-connection")
      return json({ state: "connected", models: [{ id: "saved-model", name: "saved-model", reasoningEfforts: [] }] });
    if (path === "/api/configuration/synchronisation") return json(this.#record(this.view.revision!.document, "file"));
    if (path === "/api/configuration/file") {
      this.fileChanged = false;
      this.view = { ...this.view, file: "in_step" };
      return json(this.view);
    }
    const change = JSON.parse(body!) as RevisionChange;
    if (change.basedOn !== (this.view.revision?.number ?? 0)) return problem("stale_revision", 409);
    const errors = errorsOf(change.document);
    if (errors.length > 0) return problem("invalid_configuration", 422, errors);
    this.saved.push(change);
    return json(this.#record(change.document, "console"), 201);
  };
}
