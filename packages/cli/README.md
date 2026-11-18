# @open-qa-stack/cli

The `oqas` command: Open QA Stack in a terminal — see [docs/solo-command.md](docs/solo-command.md).

The command holds no rule of a session. It is a presentation of the operations on sessions of [`@open-qa-stack/engine`](../engine/docs/engine.md#the-operations-on-sessions), on the database of the instance, which [`@open-qa-stack/store`](../store/docs/database.md) assembles for it as for the API: it opens a session and runs it in its own process, or reads, follows, speaks to and interrupts the sessions another process runs.
