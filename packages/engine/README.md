# @open-qa-stack/engine

The application core of Open QA Stack. The run, from the configuration to the summary, written once: it maps the target application, designs Playwright tests on a new local branch, runs them and gives a verdict per test. And the operations on the sessions of an instance — open one, speak to it, interrupt it, follow it — which run each session in the process that hosts them. A command line, a REST API, are presentations that plug the engine into its ports and call its operations — see [docs/engine.md](docs/engine.md).
