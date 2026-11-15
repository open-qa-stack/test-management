/**
 * The name of the tab of an application in a test: the application of a test keeps its `page`, and each
 * other one it acts on has a page of its own in the same browser context, so that what is under way on one
 * stays as it is while the test acts on another.
 *
 * @param application - Identifier of the application, such as `customer-management`.
 * @returns The name, such as `customerManagementPage`.
 */
export function tabVariable(application: string): string {
  const [first = "", ...rest] = application.split(/[^a-zA-Z0-9]+/).filter((part) => part !== "");
  const name = [first.toLowerCase(), ...rest.map((part) => `${part[0]!.toUpperCase()}${part.slice(1).toLowerCase()}`)].join("");
  return `${/^[0-9]/.test(name) ? "app" : ""}${name}Page`;
}
