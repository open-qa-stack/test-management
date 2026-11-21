import assert from "node:assert/strict";
import type { SecretState } from "@open-qa-stack/domain/sessions";
import { createElement } from "react";
import { describe, it } from "vitest";
import { EditContext, NO_EDIT } from "../../src/configuration/configuration-edit.ts";
import { SecretField, type SecretFieldProps } from "../../src/configuration/configuration-fields.tsx";
import { render, textOf } from "../render.ts";

/** A variable of the configuration in force, and where its value comes from. */
const secret = (source: SecretState["source"]): SecretState => ({ name: "MODEL_KEY", kind: "model_key", paths: ["/model/apiKeyEnv"], source });

/** The field of a variable, in an edit that knows these variables and holds these values. */
const field = (props: SecretFieldProps, secrets?: readonly SecretState[], values: Readonly<Record<string, string>> = {}): string =>
  render(
    createElement(EditContext.Provider, { value: { ...NO_EDIT, values, ...(secrets === undefined ? {} : { secrets }) } }, createElement(SecretField, props)),
  );

describe("the field of the value of a variable", () => {
  it("shows nothing while the draft names no variable", () => {
    assert.equal(field({ variable: undefined, kind: "model_key" }), "");
    assert.equal(field({ variable: "", kind: "model_key" }), "");
  });

  it("asks for a value the instance does not hold yet, unseen, and says where it is kept", () => {
    const html = field({ variable: "MODEL_KEY", kind: "model_key" }, undefined, { MODEL_KEY: "typed" });
    assert.match(html, /<label for="secret-MODEL_KEY">Clé<\/label>/);
    assert.match(html, /<input id="secret-MODEL_KEY" type="password" data-kind="secret" data-variable="MODEL_KEY" [^>]*name="secret-MODEL_KEY" value="typed"/);
    assert.match(html, /autoComplete="new-password"/);
    assert.match(textOf(html), /Gardée sur l’ordinateur où tourne l’outil, hors du dépôt de tests et de la base, dans MODEL_KEY/);
    assert.doesNotMatch(html, /placeholder/);
    assert.match(field({ variable: "MODEL_KEY", kind: "model_key" }, [secret("missing")]), /value=""/);
  });

  it("offers to replace a value saved, which it never shows", () => {
    const html = field({ variable: "MODEL_KEY", kind: "model_key" }, [secret("saved")]);
    assert.match(html, /placeholder="Enregistrée — tapez pour la remplacer"/);
    assert.match(textOf(html), /Une valeur est enregistrée pour MODEL_KEY sur cet ordinateur ; tapez-en une autre pour la remplacer\./);
  });

  it("asks nothing of a variable the environment sets, which wins", () => {
    const html = field({ variable: "MODEL_KEY", kind: "model_key" }, [secret("environment")]);
    assert.doesNotMatch(html, /<input/);
    assert.match(textOf(html), /Clé vient de la variable MODEL_KEY de l’environnement de l’outil, qui l’emporte sur une valeur tapée ici\./);
  });

  it("shows the name of a test account as it is typed, and hides its password", () => {
    assert.match(
      field({ variable: "QA_USER", kind: "account_username" }),
      /<label for="secret-QA_USER">Identifiant<\/label><input id="secret-QA_USER" type="text"[^>]*autoComplete="off"/,
    );
    assert.match(
      field({ variable: "QA_PASSWORD", kind: "account_password" }),
      /<label for="secret-QA_PASSWORD">Mot de passe<\/label><input [^>]*type="password"/,
    );
    assert.match(field({ variable: "DB_URL", kind: "connection_string" }), /<label for="secret-DB_URL">Chaîne de connexion<\/label>/);
  });
});
