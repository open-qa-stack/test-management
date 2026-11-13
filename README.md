# Open QA Stack

Test campaigns for Playwright, drafted by agents and decided by people.

## License

Open QA Stack is licensed under the [Apache License, Version 2.0](LICENSE) (`Apache-2.0`).

## Checking a change

`pnpm check`, run at the root of the repository with the Node.js `.nvmrc` names, tells whether a commit can be delivered. It runs the steps below in order, stops at the first that fails, names it, and changes no file.

1. **typecheck**: `tsc` in strict mode on every package and on the lint rules of the workspace.
2. **lint**: oxlint with type information and the lint rules of the workspace, in `lint/`, warnings denied. An explicit `any` fails.
3. **format**: Prettier, without rewriting anything. `pnpm format` rewrites the files it would change.
4. **build**: the `build` script of every package that has one. The packages that run their TypeScript sources as they are have none.
5. **coverage directives**: a `node:coverage ignore` or `node:coverage disable` comment in a source file gives, on its line or the line before, the URL of the issue of this repository that explains it, such as `https://github.com/open-qa-stack/test-management/issues/1`.
6. **secrets**: no file of the index holds a secret, by the rules of [the scan](#scanning-before-publishing).
7. **tests and coverage**: the tests of every package, one package after the other, which cover 100 % of the lines, branches and functions of every file of code under its `src` folder, files no test loads included. Tests, scripts, fixtures and configuration files live outside `src` and are not measured, and neither is a file that only declares types. The check reads what was covered from a report of the test runner: a `test` script that lowers a threshold or leaves a file out of the measure changes nothing, and a file of code missing from the report fails. A module that only runs in a browser, listed under `coverage.measuredInBrowser` in the manifest of its package, is left to the tests of that package, which measure it there. The `test` script of a package with source files starts the test runner with `--experimental-test-coverage`, which Node.js does not accept from `NODE_OPTIONS`.
8. **lint rules**: the tests of the lint rules of the workspace, which cover all of `lint/`.

Once the dependencies are installed with `pnpm install --frozen-lockfile`, the check needs no network.

## Commits

A commit is ready when `pnpm check` passes on it. Its message follows [Conventional Commits](https://www.conventionalcommits.org/): a type among `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore` and `revert`, the scope between parentheses when there is one, and a subject of 72 bytes at most, which is 72 characters in ASCII, such as `feat(check): scan the commits of a branch`. A commit is the work of its author: its message carries no `Co-authored-by` or `Generated-by` trailer.

A merge commit is a commit like the others. The message git proposes for it, `Merge branch '<branch>'`, does not follow the convention: give the merge a subject of its own, which says what the merged branch brings.

```sh
git merge --no-ff -m "feat(check): scan the commits of a branch" <branch>
```

## Scanning before publishing

`pnpm scan` looks for what must not be published, and changes nothing.

- Without arguments, it scans the files of the index for secrets.
- With revision ranges, as `git log` reads them (`pnpm scan main..HEAD`), or with `--all` for every branch and tag, it also scans the commits they select: the message of each commit, by the rules of the section above, and the lines it adds, for secrets. The lines a merge adds are those its author wrote on top of what git would have merged by itself, which needs git 2.36 or later.

Its rules find a secret by its format: `private-key` a private key in the PEM format, and `github-token` a token in the format of a GitHub token. A finding names the file, the commit when there is one, and the rule, never the secret. The scan ends with `0` when it found nothing, `1` when it found something, and `2` when its arguments or a revision are wrong.
