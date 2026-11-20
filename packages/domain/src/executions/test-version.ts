/**
 * A version of a test: what the instance numbers, from 1, each time an execution runs it changed since the latest
 * one, by the digest of the test without its comments nor its layout.
 */
export interface TestVersion {
  /** The path of the file of the test, relative to the root of the test repository. */
  readonly path: string;
  /** Its titles, as `<describe>… › <title>`. */
  readonly title: string;
  /** Its number among the versions of the test, from 1. */
  readonly number: number;
  /** The SHA-256 of the test at this version, in hexadecimal. */
  readonly digest: string;
  /**
   * The commit the test repository was at when an execution first ran this version committed; left out for a version
   * only ever run before it was committed, such as one a design ran.
   */
  readonly commit?: string;
  /** When an execution first ran it, as an ISO 8601 date. */
  readonly since: string;
  /** How many executions ran it. */
  readonly executions: number;
}

/** The versions of the tests of one file, the latest first, as `GET /tests/versions` answers. */
export interface TestVersionList {
  readonly items: readonly TestVersion[];
}

/** What the latest version of a test becomes with a result: `kept` as it is, `committed` when it gets its commit, `next` for a new version. */
export type VersionStep =
  | { readonly kind: "kept"; readonly number: number }
  | { readonly kind: "committed"; readonly number: number; readonly commit: string }
  | { readonly kind: "next"; readonly number: number; readonly commit?: string };

/**
 * The version of a test a result ran it at: the latest one while its digest is that of the result, a new one numbered
 * after it otherwise. A version takes the commit of the first execution that ran it committed.
 *
 * @param latest - The latest version of the test; `undefined` for a test never versioned.
 * @param digest - The digest of the test in the result.
 * @param commit - The commit of the execution, when the test was the same in it.
 * @returns What becomes of the latest version.
 */
export function versionStep(latest: Pick<TestVersion, "number" | "digest" | "commit"> | undefined, digest: string, commit: string | undefined): VersionStep {
  if (latest === undefined || latest.digest !== digest) return { kind: "next", number: (latest?.number ?? 0) + 1, ...(commit === undefined ? {} : { commit }) };
  if (latest.commit === undefined && commit !== undefined) return { kind: "committed", number: latest.number, commit };
  return { kind: "kept", number: latest.number };
}
