import { dirname, relative, resolve, sep } from "node:path";
import { declaredVariables, type ResolvedConfig } from "@open-qa-stack/shared";
import { secretForms, type ModuleImport } from "@open-qa-stack/tools";

/** The only package a generated test may import. */
export const TEST_MODULE = "@playwright/test";

/** A module path that names a test file, with or without its extension. */
const TEST_FILE = /\.(spec|test)(\.[cm]?[jt]sx?)?$/;

/** The value of an environment variable the configuration names, which no generated test may hold. */
export interface DeclaredSecret {
  /** Name of the variable. */
  readonly variable: string;
  /** Its value, as the environment gives it. */
  readonly value: string;
}

/**
 * Every address the configuration declares, as it is written and by its host alone: the user interfaces and
 * the APIs of each environment, and the contracts served at a URL.
 *
 * @param config - The resolved configuration.
 * @returns The forms, each once.
 */
export function declaredAddresses(config: ResolvedConfig): string[] {
  const urls = [
    ...config.applications.flatMap((application) =>
      application.environments.flatMap((environment) => [
        ...(environment.uiUrl === undefined ? [] : [environment.uiUrl]),
        ...(environment.apis ?? []).map((api) => api.baseUrl),
      ]),
    ),
    ...config.knowledge.flatMap((source) => (source.type === "openapi" && source.url !== undefined ? [source.url] : [])),
  ];
  return [...new Set(urls.flatMap((url) => [url.replace(/\/+$/, ""), new URL(url).host]))];
}

/**
 * The values of the environment variables the configuration names: the credentials of the test accounts,
 * the connection strings and the key of the model.
 *
 * @param config - The resolved configuration.
 * @param env - The environment the configuration reads.
 * @returns Each variable set and not empty, with its value.
 */
export function declaredSecrets(config: ResolvedConfig, env: Readonly<Record<string, string | undefined>>): DeclaredSecret[] {
  const names = [...new Set(declaredVariables(config).map((variable) => variable.name))];
  return names.flatMap((variable) => (env[variable] ? [{ variable, value: env[variable] }] : []));
}

/**
 * The packages a generated test may import: those the `package.json` of the test repository declares, its
 * team choosing its tools by installing them, and `@playwright/test` when it declares none.
 *
 * @param manifest - The text of `package.json`; none when it cannot be read.
 * @returns The names of the packages, each once.
 */
export function testPackages(manifest: string | undefined): string[] {
  const parsed = parseManifest(manifest);
  const names = [parsed?.dependencies, parsed?.devDependencies].flatMap((section) =>
    section !== null && typeof section === "object" ? Object.keys(section) : [],
  );
  return names.length === 0 ? [TEST_MODULE] : [...new Set(names)];
}

/** The sections of a `package.json` that list packages; none when it cannot be read. */
function parseManifest(manifest: string | undefined): { readonly dependencies?: unknown; readonly devDependencies?: unknown } | undefined {
  if (manifest === undefined) return undefined;
  try {
    return (JSON.parse(manifest) as { dependencies?: unknown; devDependencies?: unknown } | null) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Refuses every import of a test but the packages of the test repository, or a path inside one, and the
 * relative paths inside the test repository that name no other test file.
 *
 * @param imports - The modules the test imports.
 * @param path - Absolute path of the test.
 * @param repositoryRoot - Absolute path of the test repository.
 * @param packages - The packages a test may import, as `testPackages` gives them.
 * @returns A sentence for each refused import, which names its module.
 */
export function importErrors(imports: readonly ModuleImport[], path: string, repositoryRoot: string, packages: readonly string[] = [TEST_MODULE]): string[] {
  const allowed = `import only ${packages.join(", ")} or a relative path inside the test repository`;
  return imports.flatMap(({ module, line }) => {
    if (module !== undefined && packages.some((name) => module === name || module.startsWith(`${name}/`))) return [];
    if (module === undefined) return [`Line ${line} imports a module whose name is computed; ${allowed}.`];
    if (!module.startsWith("./") && !module.startsWith("../")) return [`Line ${line} imports ${module}; ${allowed}.`];
    const inside = relative(repositoryRoot, resolve(dirname(path), module));
    if (inside === ".." || inside.startsWith(`..${sep}`)) return [`Line ${line} imports ${module}, outside the test repository.`];
    if (TEST_FILE.test(module)) return [`Line ${line} imports ${module}, another test file; a test never imports another.`];
    return [];
  });
}

/** What writes a file from a test: a download saved, a browser state stored, a PDF, or any `path` option. */
const FILE_WRITE = /\.(saveAs|storageState|pdf)\s*\(|\bpath\s*:/;

/**
 * Refuses a test that writes a file: what a test leaves goes where the runner puts it, never where the
 * test says.
 *
 * @param content - Text of the test.
 * @returns A sentence when it writes one.
 */
export function fileErrors(content: string): string[] {
  return FILE_WRITE.test(content)
    ? [
        "The test writes a file (saveAs, storageState, pdf or a path option); a test writes no file, the runner keeps what it needs. To compare a page with its reference, use await expect(page).toHaveScreenshot().",
      ]
    : [];
}

/**
 * Refuses a test that holds an address the configuration declares.
 *
 * @param content - Text of the test.
 * @param addresses - The declared addresses, as `declaredAddresses` gives them.
 * @returns A sentence for each address it holds.
 */
export function addressErrors(content: string, addresses: readonly string[]): string[] {
  return addresses
    .filter((address) => content.includes(address))
    .map((address) => `The test holds ${address}, an address of the configuration; reach the application with a path relative to its base URL.`);
}

/**
 * Refuses a proposal that holds the value of a variable the configuration names, in any form a tool may
 * show it.
 *
 * @param text - Text of the proposal.
 * @param secrets - The declared values.
 * @returns A sentence for each variable whose value it holds, which names the variable, never the value.
 */
export function secretValueErrors(text: string, secrets: readonly DeclaredSecret[]): string[] {
  return heldVariables(text, secrets).map((variable) => `The proposal holds the value of ${variable}; read it with process.env.${variable} instead.`);
}

/**
 * The variables the configuration names whose value a text holds, in any form a tool may show it.
 *
 * @param text - The text.
 * @param secrets - The declared values.
 * @returns The names of the variables, never their values.
 */
export function heldVariables(text: string, secrets: readonly DeclaredSecret[]): string[] {
  return secrets.filter(({ value }) => secretForms(value).some((form) => text.includes(form))).map(({ variable }) => variable);
}
