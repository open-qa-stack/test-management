# @open-qa-stack/cli

The `oqas` command, which runs Open QA Stack on a development machine without an instance — see [docs/solo-command.md](docs/solo-command.md).

The command holds no step of a run: it reads its options, then hosts a run of [`@open-qa-stack/engine`](../engine/docs/engine.md), which it plugs into the terminal and the files of the test repository.
