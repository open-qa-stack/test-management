# @open-qa-stack/api

The back end of an instance: a NestJS application on the Fastify adapter that keeps its state in one PostgreSQL database — see [docs/running.md](docs/running.md) and [docs/database.md](docs/database.md). It serves the project and the sessions of the agents, with the events of each session as a stream — see [docs/sessions.md](docs/sessions.md).
