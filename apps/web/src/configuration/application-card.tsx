import type { ReactNode } from "react";
import type { ConfiguredApplication, Environment } from "@open-qa-stack/domain/sessions";
import { Card } from "../ui/card.tsx";
import { AddButton, ChoiceField, InputField, PlaceErrors, RemoveButton } from "./configuration-fields.tsx";

const TYPES = [
  { value: "web", label: "Interface web" },
  { value: "api", label: "API" },
  { value: "web-and-api", label: "Interface web et API" },
];

const METHODS = [
  { value: "none", label: "Aucune" },
  { value: "form", label: "Formulaire de connexion" },
];

const EXPLORATIONS = [
  { value: "read-only", label: "Lecture seule : ne change aucune donnée" },
  { value: "read-write", label: "Lecture et écriture : peut créer ou modifier, jamais supprimer" },
];

/** The name of an item of a list, or its rank when it has none yet. */
const nameOf = (name: string, what: string, rank: number): string => (name === "" ? `${what} ${rank + 1}` : `${what} ${name}`);

/**
 * The head of an item of a list: what it is, and the button that removes it, which names it.
 *
 * @param props - What the item is called, and where it is.
 * @returns The head.
 */
function ItemHead({ title, pointer, removal }: { readonly title: string; readonly pointer: string; readonly removal: string }): ReactNode {
  return (
    <div className="config-item-head">
      <span>{title}</span>
      <RemoveButton pointer={pointer} label={removal} />
    </div>
  );
}

/** An environment of an application: its addresses, its named APIs and what its exploration may do. */
function EnvironmentFields({
  at,
  environment,
  rank,
  owner,
}: {
  readonly at: string;
  readonly environment: Environment;
  readonly rank: number;
  readonly owner: string;
}): ReactNode {
  const apis = environment.apis ?? [];
  const name = nameOf(environment.name, "l’environnement", rank);
  return (
    <fieldset className="config-group">
      <legend className="sr-only">{`Environnement ${rank + 1}`}</legend>
      <ItemHead title={nameOf(environment.name, "Environnement", rank)} pointer={at} removal={`Retirer ${name} de ${owner}`} />
      <div className="config-fields">
        <InputField pointer={`${at}/name`} label="Nom" value={environment.name} hint="Comme les sessions le nomment, tel que local ou recette." />
        <InputField pointer={`${at}/uiUrl`} label="Adresse de l’interface" value={environment.uiUrl} code placeholder="https://" />
        <ChoiceField
          pointer={`${at}/exploration`}
          label="Exploration de l’interface"
          hint="Ce que l’agent qui explore l’interface peut faire des données de cet environnement."
          value={environment.exploration}
          options={EXPLORATIONS}
          none="Lecture seule (par défaut)"
        />
      </div>
      {apis.map((api, index) => (
        <div key={index} className="config-item">
          <ItemHead title={nameOf(api.name, "API", index)} pointer={`${at}/apis/${index}`} removal={`Retirer ${nameOf(api.name, "l’API", index)} de ${name}`} />
          <div className="config-fields">
            <InputField pointer={`${at}/apis/${index}/name`} label="Nom de l’API" value={api.name} />
            <InputField pointer={`${at}/apis/${index}/baseUrl`} label="Adresse de base" value={api.baseUrl} code placeholder="https://" />
          </div>
        </div>
      ))}
      <div className="config-actions">
        <AddButton pointer={`${at}/apis`} item="api">
          Ajouter une API
        </AddButton>
      </div>
    </fieldset>
  );
}

/**
 * An application of the configuration: what it is, how a user signs in with the variables of its test accounts,
 * and its environments.
 *
 * @param props - The application, and its rank in the list.
 * @returns Its card.
 */
export function ApplicationCard({ application, rank }: { readonly application: ConfiguredApplication; readonly rank: number }): ReactNode {
  const at = `/applications/${rank}`;
  const accounts = application.authentication.accounts ?? [];
  const title = application.name === "" ? `Application ${rank + 1}` : application.name;
  return (
    <Card
      title={title}
      hint={application.id === "" ? "sans identifiant" : application.id}
      aside={<RemoveButton pointer={at} label={`Retirer l’application ${title}`} />}
    >
      <div className="config-body">
        <div className="config-fields">
          <InputField pointer={`${at}/id`} label="Identifiant" value={application.id} code hint="Minuscules et chiffres séparés par des tirets." />
          <InputField pointer={`${at}/name`} label="Nom" value={application.name} />
          <ChoiceField pointer={`${at}/type`} label="Ce qu’elle expose" value={application.type} options={TYPES} />
          <ChoiceField pointer={`${at}/authentication/method`} label="Connexion des utilisateurs" value={application.authentication.method} options={METHODS} />
        </div>
        <fieldset className="config-group">
          <legend>Comptes de test</legend>
          <p className="field-hint">
            Seuls les noms des variables d’environnement sont gardés : les identifiants restent sur la machine qui lance les sessions.
          </p>
          {accounts.map((account, index) => (
            <div key={index} className="config-item">
              <ItemHead
                title={nameOf(account.name, "Compte", index)}
                pointer={`${at}/authentication/accounts/${index}`}
                removal={`Retirer ${nameOf(account.name, "le compte", index)} de ${title}`}
              />
              <div className="config-fields">
                <InputField pointer={`${at}/authentication/accounts/${index}/name`} label="Nom du compte" value={account.name} />
                <InputField pointer={`${at}/authentication/accounts/${index}/usernameEnv`} label="Variable de l’identifiant" value={account.usernameEnv} code />
                <InputField pointer={`${at}/authentication/accounts/${index}/passwordEnv`} label="Variable du mot de passe" value={account.passwordEnv} code />
              </div>
            </div>
          ))}
          <div className="config-actions">
            <AddButton pointer={`${at}/authentication/accounts`} item="account">
              Ajouter un compte
            </AddButton>
          </div>
        </fieldset>
        {application.environments.map((environment, index) => (
          <EnvironmentFields key={index} at={`${at}/environments/${index}`} environment={environment} rank={index} owner={title} />
        ))}
        <PlaceErrors pointer={`${at}/environments`} />
        <div className="config-actions">
          <AddButton pointer={`${at}/environments`} item="environment">
            Ajouter un environnement
          </AddButton>
        </div>
      </div>
    </Card>
  );
}
