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
6. **tests and coverage**: the tests of every package, one package after the other, which cover 100 % of the lines, branches and functions of every file of code under its `src` folder, files no test loads included. Tests, scripts, fixtures and configuration files live outside `src` and are not measured, and neither is a file that only declares types. The check reads what was covered from a report of the test runner: a `test` script that lowers a threshold or leaves a file out of the measure changes nothing, and a file of code missing from the report fails. A module that only runs in a browser, listed under `coverage.measuredInBrowser` in the manifest of its package, is left to the tests of that package, which measure it there. The `test` script of a package with source files starts the test runner with `--experimental-test-coverage`, which Node.js does not accept from `NODE_OPTIONS`.
7. **lint rules**: the tests of the lint rules of the workspace, which cover all of `lint/`.

Once the dependencies are installed with `pnpm install --frozen-lockfile`, the check needs no network.
