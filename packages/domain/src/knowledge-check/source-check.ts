/**
 * What the test of a knowledge source found, without the model and without indexing anything: it answers, with the
 * number of items it holds — the operations of a contract, the tables of a database, the files of a folder, the
 * documents kept —; it does not, with why; or it is not tested, logs being read while a session runs.
 */
export type SourceCheck =
  { readonly state: "ok"; readonly items: number } | { readonly state: "failed"; readonly reason: string } | { readonly state: "unchecked" };
