import type { OqasConfig } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { valueAt } from "./json-pointer.ts";

/** The label of a key of the configuration, by the section it is in, as its field names it. */
const LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  application: {
    id: "configuration.application.id",
    name: "configuration.application.name",
    type: "configuration.application.type",
    method: "configuration.application.method",
  },
  environment: { name: "configuration.application.name", uiUrl: "configuration.application.uiUrl", exploration: "configuration.application.exploration" },
  api: { name: "configuration.application.apiName", baseUrl: "configuration.application.baseUrl" },
  account: {
    name: "configuration.application.accountName",
    usernameEnv: "configuration.application.usernameEnv",
    passwordEnv: "configuration.application.passwordEnv",
  },
  source: {
    id: "configuration.application.id",
    url: "configuration.knowledge.url",
    path: "configuration.places.path",
    connectionStringEnv: "configuration.knowledge.connectionStringEnv",
    commands: "configuration.knowledge.commands",
    container: "configuration.knowledge.container",
    engine: "configuration.knowledge.engine",
  },
  attachment: { application: "configuration.knowledge.application", environment: "configuration.knowledge.environment", api: "configuration.knowledge.api" },
  model: {
    baseUrl: "configuration.model.baseUrl",
    apiKeyEnv: "configuration.model.apiKeyEnv",
    model: "configuration.model.model",
    reasoningEffort: "configuration.model.reasoningEffort",
    requestTimeoutSeconds: "configuration.model.timeout",
    roles: "configuration.model.roles.title",
    cartographer: "configuration.model.roles.cartographer",
    designer: "configuration.model.roles.designer",
    reviewer: "configuration.model.roles.reviewer",
  },
  autonomy: { level: "configuration.settings.autonomy.level", guardrailMinutes: "configuration.settings.autonomy.guardrail" },
};

/** The sections the root of the configuration holds, by their key. */
const SECTIONS: Readonly<Record<string, string>> = {
  model: "configuration.model.title",
  autonomy: "configuration.settings.autonomy.title",
  design: "configuration.settings.design.title",
  repository: "configuration.settings.repository.title",
  language: "configuration.settings.languages.language",
  testLanguage: "configuration.settings.languages.testLanguage",
};

/** The text of a key these tables name, which the words of each language hold. */
const text = (key: string, options: Readonly<Record<string, number | string>> = {}): string => t(key, { ...options, defaultValue: key });

/** The name of an item of a list as the person reads it: its name, or its rank while it has none. */
function named(item: unknown, rank: number, untitled: string): string {
  const value = (item as Record<string, unknown> | undefined)?.["name"];
  return typeof value === "string" && value !== "" ? value : text(untitled, { rank: rank + 1 });
}

/**
 * Says where a place of the configuration is, as a person reads it: the application, the environment, the source or
 * the section, then the field, such as « Source pricing › Sert à 1 › Application ».
 *
 * @param path - The JSON Pointer of the place.
 * @param draft - The configuration the place is in, which names its items.
 * @returns Where it is; the configuration as a whole for its root.
 */
export function placeText(path: string, draft: OqasConfig | undefined): string {
  const segments = path.split("/").slice(1);
  if (segments.length === 0) return t("configuration.places.whole");
  const parts: string[] = [];
  let section = "";
  for (let at = 0; at < segments.length; at++) {
    const segment = segments[at]!;
    const pointer = `/${segments.slice(0, at + 1).join("/")}`;
    const rank = Number(segment);
    const parent = segments[at - 1];
    if (Number.isInteger(rank) && parent !== undefined) {
      const item = valueAt(draft, pointer);
      if (parent === "applications") parts.push(named(item, rank, "configuration.application.untitled"));
      else if (parent === "environments") parts.push(t("configuration.application.environment", { name: named(item, rank, "configuration.places.rank") }));
      else if (parent === "apis") parts.push(t("configuration.application.api", { name: named(item, rank, "configuration.places.rank") }));
      else if (parent === "accounts") parts.push(t("configuration.application.account", { name: named(item, rank, "configuration.places.rank") }));
      else if (parent === "knowledge") {
        // A source is named by its identifier, or by its rank while it has none, which says it is a source already.
        const id = (item as Record<string, unknown> | undefined)?.["id"];
        parts.push(
          typeof id === "string" && id !== ""
            ? text("configuration.places.source", { name: id })
            : text("configuration.knowledge.untitled", { rank: rank + 1 }),
        );
      } else if (parent === "attachments") parts.push(t("configuration.places.attachment", { rank: rank + 1 }));
      else parts.push(String(rank + 1));
      section =
        { applications: "application", environments: "environment", apis: "api", accounts: "account", knowledge: "source", attachments: "attachment" }[
          parent
        ] ?? section;
      continue;
    }
    if (["applications", "environments", "apis", "accounts", "knowledge", "attachments", "authentication"].includes(segment)) continue;
    if (at === 0 && SECTIONS[segment] !== undefined) {
      parts.push(text(SECTIONS[segment]));
      section = segment;
      continue;
    }
    const label = LABELS[section]?.[segment];
    parts.push(label === undefined ? segment : text(label));
  }
  return parts.join(" › ");
}
