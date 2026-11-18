# @open-qa-stack/cli

The `oqas` command: Open QA Stack in a terminal — see [docs/solo-command.md](docs/solo-command.md).

The command holds no rule of a session. It is a presentation of the operations on sessions of [`@open-qa-stack/engine`](../engine/docs/engine.md#the-operations-on-sessions), on the database of the instance, which [`@open-qa-stack/store`](../store/docs/database.md) assembles for it as for the API: it opens a session and runs it in its own process, or reads, follows, speaks to and interrupts the sessions another process runs. Without a command, in a terminal, it opens a conversation that does all of it on one screen, drawn with [Ink](https://github.com/vadimdemedes/ink). With `--ui` it serves the console in a browser, by starting in its own process the application of [`@open-qa-stack/api`](../api/docs/running.md#starting-the-api-from-a-program) on the same database.
