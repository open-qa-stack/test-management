# Open QA Stack

Test campaigns for Playwright, drafted by agents and decided by people.

## License

Open QA Stack is licensed under the [Apache License, Version 2.0](LICENSE) (`Apache-2.0`).

## Checking a change

`pnpm check`, run at the root of the repository with the Node.js `.nvmrc` names, tells whether a commit can be delivered. It runs the steps below in order, stops at the first that fails, names it, and changes no file.

1. **typecheck**: `tsc` in strict mode on every package and on the lint rules of the workspace.
2. **lint**: oxlint with type information and the lint rules of the workspace, in `lint/`, warnings denied, then the check of the manifests against [the package boundaries](#package-boundaries). An explicit `any` fails.
3. **format**: Prettier, without rewriting anything. `pnpm format` rewrites the files it would change.
4. **build**: the `build` script of every package that has one. The packages that run their TypeScript sources as they are have none.
5. **coverage directives**: a `node:coverage ignore` or `node:coverage disable` comment in a source file gives, on its line or the line before, the URL of the issue of this repository that explains it, such as `https://github.com/open-qa-stack/test-management/issues/1`.
6. **secrets**: no file of the index holds a secret, by the rules of [the scan](#scanning-before-publishing).
7. **tests and coverage**: the tests of every package, four packages at a time and the test files of a package side by side, which cover 100 % of the lines, branches and functions of every file of code under its `src` folder, files no test loads included. The output of a package is written in one piece once its tests have ended. Tests, scripts, fixtures and configuration files live outside `src` and are not measured, and neither is a file that only declares types. The check reads what was covered from a report of the test runner: a `test` script that lowers a threshold or leaves a file out of the measure changes nothing, and a file of code missing from the report fails. A module that only runs in a browser, listed under `coverage.measuredInBrowser` in the manifest of its package, is left to the tests of that package, which measure it there. The `test` script of a package with source files starts the test runner with `--experimental-test-coverage`, which Node.js does not accept from `NODE_OPTIONS`.
8. **lint rules**: the tests of the lint rules of the workspace, which cover all of `lint/`.

Once the dependencies are installed with `pnpm install --frozen-lockfile`, the check needs no network.

## Package boundaries

Each package depends only on the packages its row names. `pnpm lint` refuses any other import in the sources of a package, under its `src` folder, whatever its form: the name of the package or a path into it, a relative path out of the folder of the package or through its `node_modules`, a dynamic import or a `require` of a constant string, an `import … = require(…)`, a type-only import or a re-export. It refuses the same dependency in the `dependencies`, `peerDependencies` and `optionalDependencies` of the manifest of the package. Each refusal names the file, the line, the package, what it imports and the rule.

| Package   | Folder             | Depends on                                       |
| --------- | ------------------ | ------------------------------------------------ |
| `domain`  | `packages/domain`  | nothing                                          |
| `shared`  | `packages/shared`  | nothing                                          |
| `api`     | `packages/api`     | `domain`, `shared`                               |
| `harness` | `packages/harness` | `domain`, `shared`                               |
| `tools`   | `packages/tools`   | `domain`, `shared`                               |
| `agents`  | `packages/agents`  | `domain`, `shared`, `tools`                      |
| `worker`  | `packages/worker`  | `harness`, `agents`, `tools`, `domain`, `shared` |
| `cli`     | `packages/cli`     | `shared`, `harness`, `agents`, `tools`, `domain` |
| `web`     | `apps/web`         | `shared`                                         |

- `worker` has no folder yet: the table bounds it from its first file.
- The domain imports no external module, those of Node.js included, but the ones listed under `external` in its row of the table, none for now. It holds no decorator, of the experimental TypeScript kind or of the standard one.
- The command line keeps its two modes apart, the solo mode in `src/solo/` and the connected mode in `src/connected/`. An override of the lint configuration on `src/connected/` lets its files import `shared` only among the packages of the workspace, and no other file of the command line.
- `@github/copilot-sdk` is imported under `packages/harness/src/copilot/` only, by the implementation of the agent runtime, and by no other file, a test included.
- The tests of a package and its `devDependencies` are left out of the table: a test may run a package with the ones that use it, and the private `testing` package holds what the tests share.

The table lives in `.oxlintrc.json`, as the options of the rule `open-qa-stack/package-boundaries`, which `lint/check-manifests.ts` also reads.

## Commits

A commit is ready when `pnpm check` passes on it. Its message follows [Conventional Commits](https://www.conventionalcommits.org/): a type among `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore` and `revert`, the scope between parentheses when there is one, and a subject of 72 bytes at most, which is 72 characters in ASCII, such as `feat(check): scan the commits of a branch`. A commit is the work of its author: its message carries no `Co-authored-by` or `Generated-by` trailer.

A merge commit is a commit like the others. The message git proposes for it, `Merge branch '<branch>'`, does not follow the convention: give the merge a subject of its own, which says what the merged branch brings.

```sh
git merge --no-ff -m "feat(check): scan the commits of a branch" <branch>
```

## Continuous integration

The pipeline of the repository, in `.github/workflows/`, runs on every pull request and on every commit of `main`. It only reads the repository, holds no secret and publishes nothing, so it runs the same way for a pull request that comes from a fork. Every action it uses is pinned to a commit.

| Workflow | Job | What it verifies |
|---|---|---|
| `ci` | `check` | `pnpm check` on a clean clone, with the Node.js `.nvmrc` names, the dependencies installed from the frozen lockfile and the Chromium the workspace pins. |
| `ci` | `hygiene` | `pnpm scan` on every commit the pull request brings, not only its last: the message of each, and the lines it adds. |
| `ci` | `advisories` | No production dependency has a known vulnerability of moderate severity or more. |
| `release` | `candidate` | Started by hand for a version: the check, the scan of the whole history, the advisories, then the tarball of every package, kept as artifacts of the run. It publishes nothing and tags nothing. |

A pull request can be merged once `check`, `hygiene` and `advisories` are green: they are the required checks of `main`. `.github/dependabot.yml` proposes, each week, the updates of the pinned dependencies and those of the actions, each kind in one pull request, so that the pipeline runs once for them.

## Scanning before publishing

`pnpm scan` looks for what must not be published, and changes nothing.

- Without arguments, it scans the files of the index for secrets.
- With revision ranges, as `git log` reads them (`pnpm scan main..HEAD`), or with `--all` for every branch and tag, it also scans the commits they select: the message of each commit, by the rules of the section above, and the lines it adds, for secrets. The lines a merge adds are those its author wrote on top of what git would have merged by itself, which needs git 2.36 or later.

Its rules find a secret by its format: `private-key` a private key in the PEM format, and `github-token` a token in the format of a GitHub token. A finding names the file, the commit when there is one, and the rule, never the secret. The scan ends with `0` when it found nothing, `1` when it found something, and `2` when its arguments or a revision are wrong.
