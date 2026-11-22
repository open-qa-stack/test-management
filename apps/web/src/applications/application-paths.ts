import type { ConfiguredApplication, OqasConfig } from "@open-qa-stack/domain/sessions";

/** The address of the applications, under which an application is added. */
export const APPLICATIONS = "/applications";

/** The address of an application, whose identifier is a slug. */
export const applicationPath = (id: string): string => `${APPLICATIONS}/${id}`;

/** The applications of a configuration. */
export const applicationsOf = (document: OqasConfig): readonly ConfiguredApplication[] => document.applications;
