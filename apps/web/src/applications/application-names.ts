import type { Application, ConfiguredApplication } from "@open-qa-stack/domain/sessions";

/** The name of each application of the project, by its identifier, as the instance last described the project. */
let names: ReadonlyMap<string, string> = new Map();

/**
 * Keeps the names of the applications of the project, which every screen then shows instead of their identifiers.
 *
 * @param applications - The applications, as the instance described the project.
 */
export function nameApplications(applications: readonly Application[]): void {
  names = new Map(applications.filter(({ name }) => name !== "").map(({ id, name }) => [id, name]));
}

/**
 * Names an application for a person.
 *
 * @param id - Its identifier, as a test, an execution or a session gives it.
 * @returns Its name; the identifier for an application the project does not describe.
 */
export function applicationName(id: string): string {
  return names.get(id) ?? id;
}

/**
 * Names an application of the configuration.
 *
 * @param applications - The applications of the configuration.
 * @param id - The identifier of one of them.
 * @returns Its name; the identifier for an application that has none, or that the configuration does not declare.
 */
export function nameIn(applications: readonly ConfiguredApplication[], id: string): string {
  return applications.find((application) => application.id === id && application.name !== "")?.name ?? id;
}
