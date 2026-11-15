/**
 * Variable that gives the base address of an application to the tests: to the project of the application, and to
 * a test of another application that opens one of its addresses.
 *
 * @param application - Identifier of the application, such as `policy-management`.
 * @returns Its name, such as `OQAS_BASE_URL_POLICY_MANAGEMENT`.
 */
export function baseUrlVariable(application: string): string {
  return `OQAS_BASE_URL_${application.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}
