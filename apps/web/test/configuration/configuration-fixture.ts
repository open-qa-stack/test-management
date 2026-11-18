import type { ConfigurationView, OqasConfig, RevisionSummary } from "@open-qa-stack/domain/sessions";

/** A configuration of one web application with an account and an API, a source of each kind, and a bounded autonomy. */
export const DOCUMENT: OqasConfig = {
  formatVersion: 1,
  applications: [
    {
      id: "shop",
      name: "Shop",
      type: "web-and-api",
      authentication: { method: "form", accounts: [{ name: "clerk", usernameEnv: "SHOP_USER", passwordEnv: "SHOP_PASSWORD" }] },
      environments: [
        { name: "local", uiUrl: "http://127.0.0.1:3000", exploration: "read-write", apis: [{ name: "backend", baseUrl: "http://127.0.0.1:3001" }] },
      ],
    },
  ],
  knowledge: [
    {
      id: "contract",
      type: "openapi",
      url: "http://127.0.0.1:3001/openapi.json",
      attachments: [{ application: "shop", environment: "local", api: "backend" }],
    },
    { id: "local-contract", type: "openapi", path: "specs/openapi.yaml", attachments: [{ application: "shop" }] },
    { id: "orders", type: "postgresql", connectionStringEnv: "SHOP_DB_URL", attachments: [{ application: "shop" }] },
    { id: "specs", type: "document", path: "specs/orders.md", attachments: [{ application: "shop" }] },
    { id: "code", type: "source-code", path: "../shop", attachments: [{ application: "shop" }] },
    { id: "server-log", type: "logs", path: "logs/server.log", attachments: [{ application: "shop" }] },
    { id: "container-log", type: "logs", container: "shop", engine: "podman", attachments: [{ application: "shop" }] },
  ],
  repository: { appsDir: "tests" },
  design: { levels: ["smoke", "business"] },
  model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "test-model", apiKeyEnv: "MODEL_KEY", capabilities: ["vision"] },
  autonomy: { level: "bounded", task: { maxMinutes: 10 }, guardrailMinutes: 60 },
};

/** The revisions of that configuration, the latest first. */
export const REVISIONS: readonly RevisionSummary[] = [
  { number: 2, recordedAt: "2026-11-18T09:12:00.000Z", origin: "console", fileDigest: "b2" },
  { number: 1, recordedAt: "2026-11-18T08:40:00.000Z", origin: "file", fileDigest: "a1" },
];

/** The configuration in force, its file in step. */
export const VIEW: ConfigurationView = { revision: { ...REVISIONS[0]!, document: DOCUMENT }, file: "in_step" };

/** A configuration that leaves out every key it may: an autonomous level, the levels and the layout by default. */
export const BARE: OqasConfig = {
  formatVersion: 1,
  applications: [{ id: "", name: "", type: "web", authentication: { method: "none" }, environments: [{ name: "", uiUrl: "" }] }],
  knowledge: [],
  model: { mode: "provider-key", provider: "openai", baseUrl: "", model: "" },
};
