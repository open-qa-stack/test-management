import { applicationVariable } from "./application-variable.ts";

/**
 * The name of the tab a test opens itself for another application, in a repository whose fixtures do not
 * give that application: the application of the test keeps its `page`, and each other one has a page of its
 * own in the same browser context.
 *
 * @param application - Identifier of the application, such as `customer-management`.
 * @returns The name, such as `customerManagementPage`.
 */
export function tabVariable(application: string): string {
  return `${applicationVariable(application)}Page`;
}
