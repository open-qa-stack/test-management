# The engine

The engine is the application core of Open QA Stack, and holds two things. `Run` is one run on a test repository: every step, in one place, whatever starts it. `Sessions` is [the operations on the sessions of an instance](#the-operations-on-sessions) — open one, speak to it, interrupt it, read them, follow one — which run each session with a `Run`, in the process that hosts them. No rule of the product lives outside: [the `oqas` command](../../cli/docs/solo-command.md) says the operations in a terminal, and [the API](../../api/docs/sessions.md) says them in HTTP, both on the database of the instance.

```ts
import { liveRuntime, Run } from "@open-qa-stack/engine";

const code = await new Run({
  repositoryRoot: "/work/tests",
  environment: "local",
  brief: "Test the search of a customer and their profile.",
  env: process.env,
  journal, // a JournalOutput
  print: (line) => process.stdout.write(line),
  openInbox: (run) => inboxOf(run), // an Inbox
  store, // a RunStore
  openRuntime: (config) => liveRuntime(config, process.env),
}).run();
```

## What a run does

Each step starts only when the one before succeeded; once the prerequisites passed, the summary runs whatever the end of the others.

1. **Configuration.** `oqas.json`, at the root of the test repository, is read and validated, the environment is chosen, the test charter is resolved, and the run to resume is found when one is asked for.
2. **Prerequisites.** The folder is the root of a git repository with a commit, the model server answers, `npm` can be run, and the repository is a Playwright project.
3. **Cartography.** The sources without an up-to-date card are mapped, then consolidated into the domain index, by the cartographer of `@open-qa-stack/agents`.
4. **Design.** The dependencies of the test repository are installed, then the tests are designed in passes on a new local branch, by the designer of `@open-qa-stack/agents`, each test checked against the charter and run against the application before it is kept.
5. **Execution.** The tests designed run together, and the harness pronounces a verdict per test.
6. **Summary.** The messages no agent received are told, the runtime of the agents is closed, the state of the run is written, and the summary is printed.

[The page of the command](../../cli/docs/solo-command.md#steps) says what each step does for the person who asks for the tests.

`run()` resolves with the code the run ends with, one of the `ExitCode` of `@open-qa-stack/domain`: `passed` (0), `failed` (1), `unsettled` (2), `configuration` (3), `prerequisite` (4) or `interrupted` (5). A step that stops on an unexpected error is told in the journal and ends the run with `interrupted`. `run()` rejects only when a port does: the journal refuses an entry outside a step, the summary cannot be printed, or the state cannot be written.

## What stays in the test repository

The test repository is a folder the engine works in, in every host: the branch of the design and its commits, the test files, the cards and the domain index, the design state and the traces of the agents under the state folder, and the result of the run of the tests. A host gives the engine a folder that is the root of a git repository; it does not abstract the file system. Nothing is pushed, and the git configuration of the repository is left as it is.

## Ports

A port is what differs from a host to another. The engine declares it; the host gives its adapter in the options of the run.

| Option | Port | What the engine does with it |
| --- | --- | --- |
| `journal` | `JournalOutput` | Tells what the run does, an entry at a time, and has the journal kept once the prerequisites passed. |
| `print` | `(line: string) => void` | Prints the summary, a line at a time. |
| `follow` | `(line: TraceLine) => void`, optional | Shows each line of the trace of the agents as it is written. |
| `openInbox` | `(run: RunReference) => Inbox` | Gives the agents what a person says while the run is going. |
| `store` | `RunStore` | Writes the state of the run at its end, and finds the run to resume. |
| `openRuntime` | `(config: ResolvedConfig) => Promise<OpenRuntime>` | Opens the runtime of the agents when the first step that calls the model starts, and closes it in the summary. |
| `runner` | `CommandRunner` of `@open-qa-stack/domain`, optional | Runs `npm` and the tests. |
| `now` | `() => Date`, optional | Dates the run, its entries and its steps, and counts the guardrail of the autonomy. |
| `stop` | `AbortSignal`, optional | Asks the run to stop, when its host aborts it: see [stopping a run](#stopping-a-run). |

One host plugs a run into these ports, [the operations on sessions](#the-operations-on-sessions), for every presentation — a terminal and a server alike:

| Option | The adapter the operations give |
| --- | --- |
| `journal` | `SessionJournal`: each entry becomes events of the session, once the journal is kept. |
| `print` | Nothing: the summary is the result of the session. |
| `follow` | Each line becomes events of the session. |
| `openInbox` | `SessionInbox`: the messages the person said to the session, dropped in memory once the store took them. |
| `store` | `SessionRunStore`: the state gives the result the session is completed with; no run is resumed. |
| `openRuntime` | `liveRuntime`, with the environment of the process, unless the host of the operations gives another. |
| `runner` | A `LocalRunner` in the test repository, which is the default, unless the host of the operations gives another. |
| `now` | The system clock, which is the default, unless the host of the operations gives another. |
| `stop` | The signal of the execution, aborted when the session is interrupted or its host stops. |

What a run says is the same in every host, and is declared in `@open-qa-stack/domain`, under `src/run/`, where whoever reads a run finds it without depending on the engine: `RunEntry` and its steps, `TraceLine` with its phases and its events, `RunState` and `ExitCode`, `PersonMessage`, and the folders of the state folder the agents and the tests write to — `RUNS_FOLDER`, `TRACES_FOLDER`. The engine declares its ports and none of these.

A `RunReference` names a run for a port: its identifier, `oqas-` and the date it started at, and the state folder of the test repository as the configuration names it, for a host that keeps a run beside the tests.

### `JournalOutput`

```ts
interface JournalOutput {
  location(run: RunReference): string;
  keep(run: RunReference, earlier: readonly RunEntry[]): void;
  entry(entry: RunEntry): void;
}
```

`entry` receives each entry as it is written: when, the step, whether it starts or ends the step, informs or tells an error, the message, and for the end of a step how long it took and how many requests it sent to the model. `entryLine` writes an entry as the line a person reads, the same in every host. The engine masks every value the configuration declares as a secret before an entry leaves it.

`keep` is called once, when the prerequisites passed: a run the configuration or the prerequisites stop keeps no journal. It is given the entries written so far, to be kept before those to come. The entries of the configuration were written before the secrets were known; `keep` gives them masked, so that the journal kept holds none. `location` names the journal kept, and the state of the run holds that name under `journal`.

An output that throws stops the step under way, which the journal then tells if it still can.

### `Inbox`

```ts
interface Inbox {
  pending(): readonly PersonMessage[];
  heard(): readonly PersonMessage[];
  delivered(through: number): void;
}
```

The inbox of a run is the `Inbox` of `@open-qa-stack/agents`, which the sessions that lead a step read: `pending` gives the messages no session received yet, numbered from 1 in the order they were sent, `delivered` marks them as received, and `heard` gives those received since the run started, which later sessions are recalled. Reading waits for nothing: an inbox reads what it holds and returns, which is why a host that takes the messages from elsewhere — a database — fetches them on its own and drops them in. The summary tells each message still pending, which no agent received.

`openInbox` is called once per run, after the configuration: a run resumed is a run of its own, with an inbox of its own.

### `RunStore`

```ts
interface RunStore {
  location(run: RunReference): string;
  read(run: RunReference): Promise<StoredState>;
  readAll(stateDir: string): Promise<readonly unknown[]>;
  write(run: RunReference, state: RunState): Promise<void>;
}
```

`write` is called once, in the summary, with the `RunState` of the run: what it targeted, each step with its duration and its requests to the model, what the cartography and the design produced, the verdict of each test, and the step a limit stopped when one did. A store that cannot write rejects, and `run()` rejects with it. `location` names the state kept, which the last line of the summary gives.

`read` and `readAll` serve a run that resumes another. `read` gives what is kept for a run as JSON reads it, `undefined` when nothing is, with where the store looked, which the journal names when the run cannot be resumed. `readAll` gives what is kept for every run of the test repository: the engine finds in it the run that already resumed the one asked for. The engine checks what a store gives; a store validates nothing.

## Stopping a run

A host stops a run by aborting the `AbortSignal` it gave as `stop`. Nothing is killed: the run stops itself, where it already holds its guards.

- The runtime of the agents is wrapped in a `StoppableRuntime`, next to the guardrail of the autonomy and the count of the requests. Once the stop is asked, it opens no session, and the turn under way of every session ends at once on a `RunStoppedError` — in the middle of a call to the model, which no one waits for.
- The step that led the session stops on that refusal, and the journal tells it: `The cartography stopped: the run was asked to stop.`
- No other step of the chain starts — the cartography, the design, the execution — and the one that would have started tells so. What runs outside the agents and is under way, an installation or the tests, goes to its end first.
- The summary closes the run as it closes any other: the runtime is closed, the state is written, and `run()` resolves with `interrupted` (5).

## What a host of a run provides

To run the engine, a host:

1. Gives it a test repository as a folder, the root of a git repository with a commit, and the environment variables the configuration names.
2. Implements `JournalOutput`, to show the entries to whoever follows the run and to keep them; `RunStore`, to keep the state of each run and give it back to the run that resumes it; and `Inbox`, to hand the agents what a person says while the run is going.
3. Says where the summary goes with `print`, and, to show the agents at work, takes the lines of their trace with `follow`.
4. Opens the runtime of the agents: `liveRuntime` opens it on the model of the configuration, through a gateway of its own, and is what every host uses unless it brings another `AgentRuntime`.
5. Turns the end of `run()` into what it reports: the operations on sessions end a session with the result read from the state the run wrote, and interrupt a session whose run wrote none, or was asked to stop.

A host must also expect that `keep` is never called for a run the configuration or the prerequisites stopped: a host that waits for it to tell the entries tells those it holds when `run()` returns.

A host holds no step of a run. It imports `@open-qa-stack/engine`; the engine imports no host.

## The operations on sessions

`Sessions` is what an instance does with its sessions, with no HTTP, no terminal and no SQL in it. A presentation calls these operations and adds nothing to them: [the API](../../api/docs/sessions.md) in HTTP, [the `oqas` command](../../cli/docs/solo-command.md) in a terminal.

```ts
import { Sessions } from "@open-qa-stack/engine";

const sessions = new Sessions({ store, repository: "/srv/tests", takesOver: true, env: process.env, logger });
await sessions.start();
const session = await sessions.open({ request: "Test the search of a customer.", environment: "local" });
const events = await sessions.events(session.id, 0);
const leave = events.subscribe({ event: (event) => show(event), ended: () => done(), failed: (error) => report(error) });
```

| Operation | What it does |
| --- | --- |
| `start()` | Starts hosting: saves the project of the test repository to the store, interrupts the sessions a process that died left `running`, takes over those it left waiting when the host stays, starts the first, and beats from then on. Done once; one that failed is done again when a session is next opened. |
| `stop(withinMs)` | Stops hosting: no other session starts, the one that runs is asked to stop, and its end is awaited for the time given. Resolves with `false` when it did not end in time: the execution is then left to end by itself, and gives up what the store, which its host closes, no longer takes. The beats end, and those the process gave are withdrawn: what it still hosts reads as left at once. No timer outlives it. |
| `open(opening)` | Asks the store for the session, then starts it at once when none runs: it is returned `running`, or `queued` when it waits its turn. Raises `NoRepositoryError` on a host without a test repository. |
| `say(id, message)` | Has the store take the message, which numbers it and tells it in the thread, then drops it in the inbox of the execution of the session when it runs here. |
| `interrupt(id)` | Asks a session that runs here to stop; interrupts at once one that waits; leaves in the store the interruption of one another process runs. |
| `project()`, `sessions()`, `session(id)` | Read what the store keeps. |
| `thread(id)` | Reads the events of a session so far. |
| `events(id, after)` | Gives the events of a session to follow, from a rank on, to its end. |

A session that does not exist raises `UnknownSessionError`, and one that ended refuses a message or an interruption with `SessionEndedError`: the errors of `@open-qa-stack/domain`, which a presentation words for its client.

### In the process that hosts

Whoever hosts the operations calls the engine directly, as an asynchronous function, in its own process. There is no separate process that executes and no queue between processes. The store keeps the truth — the sessions, their events, the messages — and three small things live in the memory of the process.

**The registry of the running executions.** `RunningExecutions` holds one entry per session that runs in the process, which is how an operation that names a session finds its execution again. An entry holds three things: the `inbox` the agents read at each of their steps, the `Inbox` of the run; a `stop`, an `AbortController` whose signal the run was given; and `ended`, the promise of the execution, which settles once the session has its end written and never rejects. The registry decides nothing and keeps no state of a session: an execution is added before its first step and removed after its last.

**The line of the sessions that wait.** One session runs at a time in a process: two runs in the same test repository would write on each other's branch. `WaitingSessions` is the order they are started in, the order they were asked for. When an execution ends, the next session starts.

**The notifications of the events.** `EventNotifications` wakes whoever follows a session this process hosts, once the store took what the session gained. Nothing listens to the database.

### Several processes on one store

Several processes may reach the same store: a server, and commands in terminals. The registry of one is out of reach of the others, so **the store is where they meet**, and three rules keep them out of each other's way.

**A process hosts the sessions it opened, and no other.** `Sessions` names itself when it is made, `host-` and a random identifier, and the store keeps that name on each session it asks for and starts. Only `start()` and `open()` make a process a host. One that calls neither — it reads, says, interrupts, follows — hosts nothing, beats on nothing, and never touches a session but the one it is asked about.

**A host beats.** Every `beatMs`, a second by default, a host:

1. tells the store it is alive: each session it hosts that goes on bears the date of the beat;
2. sees to what a dead host left: the sessions whose host has not beaten for `silentAfterMs`, 15 seconds by default, are interrupted when they ran, and taken over — lined up here, then run — when they waited and this host is one that stays (`takesOver`). A host that runs the session it opens and leaves, such as `oqas --brief`, takes none over: they wait for a host that stays;
3. reads the messages each session it runs was sent, and drops them in the inbox of its execution, which takes a message once;
4. reads the interruptions asked for its sessions, and aborts the `stop` of each.

A beat is a handful of short statements. One the store does not answer is reported once and made again at the next.

**What crosses processes goes through the store, and is read at the next beat.**

| From another process | What the store keeps | When the host acts |
| --- | --- | --- |
| `say(id, message)` | The message, numbered and told in the thread, pending. | At its next beat: within `beatMs`, the message is in the inbox, and the agent at work finds it at its next step. |
| `interrupt(id)` of a session that runs | The date the interruption was asked, on the session. | At its next beat: within `beatMs`, the run is asked to stop, and the session is told interrupted once it did. |
| `interrupt(id)` of a session that waits, or whose host is silent | The session, interrupted at once. | Its host finds it ended when its turn comes, and passes over it. |
| `events(id, after)` | Nothing. | The follower reads the store again every `followMs`, half a second by default, until the session ended. |

The paces are a `SessionsPace`, which a host gives as `pace`; `DEFAULT_PACE` is the one above. The silence that tells a death is long against the beat on purpose: a host that is only slow — a machine under load, a write that waits for another process — is never taken for dead. What these rules do not do: they do not keep two hosts from running a session each in the same test repository at the same time, which a person who starts a second host on a repository takes on.

### How a message travels

1. `say` has the store take the message: the store numbers it, keeps it as pending, and appends the `user_message` event that tells it.
2. The registry is asked for the execution of the session. When there is one, the message is dropped in its inbox, where the agent at work finds it at its next step; whoever follows the session is woken.
3. When there is none, the session waits, or another process runs it: the message stays pending in the store. An execution reads the pending messages of its session when it starts, and its host reads them again at each beat.
4. The run hands the message to an agent, and the trace line that tells so becomes the command of the store that marks it delivered, which appends `message_delivered`.

A message may reach the inbox more than once — dropped by `say`, it is also among those the store keeps until an agent received it — and enters it once, by its number.

### How an event travels

1. The run writes an entry of its journal or a line of the trace of its agents.
2. `RunThread` of `@open-qa-stack/domain` turns it into the events of the session, as it does for every host.
3. `SessionWriter` writes them to the store, in the order they were told, one write at a time; what is told meanwhile goes together in the next write. A write that fails is made again, after a delay that doubles up to a bound, until the store takes it.
4. Once the store took a write, the session is notified in memory, and each `SessionEventStream` subscribed to it in this process reads the store from the last event it told. A stream on a session another process hosts is notified by no one, and reads the store again at the pace of its process.

`events(id, after)` gives a `SessionEventStream`: `subscribe` tells the listener the events the store holds after the rank, then each new one as the session is notified, and ends after the event that tells the session ended — at once when that event is at or before the rank. The function `subscribe` returns stops following; a stream that ended or failed releases itself.

### The end of a session

| What happened | How the session ends |
| --- | --- |
| The run went to its summary. | `completed`, with the result read from the state the run wrote: `passed`, `failed`, `inconclusive`, or `stopped` when a step did not go to its end. |
| The configuration or a prerequisite stopped the run. | `interrupted`: the entries the run wrote are told as events, since they are all that says why. |
| The session was interrupted, or its host stopped. | `interrupted`, once the run ended by itself, whatever it wrote. |
| The run, or a reading of the store around it, failed. | `interrupted`, after a `refusal` event that says why. The failure is logged, and the next session runs. |
| The store refused to start the session. | It is logged and passed over: the session stays as the store keeps it. |
| Another process asked for its interruption. | `interrupted`, as when it is asked here: the host reads the request at its next beat. |
| The store ended the session under its execution — its host went silent for longer than the pace allows, and another took it for dead. | The execution is told to stop, and writes nothing more. |

A process that is killed leaves its session `running` in the store, and beats no more: once its silence lasted, the next host to beat interrupts the session, and an interruption asked meanwhile does so at once.

### Hosting the operations

A host gives `Sessions` a `SessionsHost`:

| Field | What the host provides |
| --- | --- |
| `store` | The `SessionStorePort` of `@open-qa-stack/domain`: where the sessions are kept. `@open-qa-stack/store` implements it on the database of the instance, a SQLite file or a PostgreSQL server. |
| `repository` | The absolute path of the test repository the sessions run in, a folder that holds `oqas.json`; `undefined` for a host that only serves what the store keeps. |
| `takesOver` | Whether the host stays to run whatever waits, as a server does, and so takes over the sessions that wait for a host that died; `false` for a host that runs the session it opens and leaves. |
| `env` | The environment of the runs: the variables the configuration of the repository names — the key of the model, the test accounts. |
| `logger` | A `SessionsLogger`: where a session that starts, one that is over and what goes wrong around them are reported. |
| `openRuntime`, optional | Opens the runtime of the agents of a run; `liveRuntime` on the model of the configuration by default. |
| `runner`, optional | The `CommandRunner` that runs npm and the tests; the machine, in the test repository, by default. |
| `now`, optional | The clock of the runs; that of the machine by default. |
| `writerPace`, optional | How a write the store failed to take is made again: 250 milliseconds at first, 10 seconds at most, by default. |
| `pace`, optional | The paces of the process among the others that reach the store: `DEFAULT_PACE` by default. |

A host calls `start()` when it starts, or lets `open()` do it, and `stop(withinMs)` before it closes its store. The two presentations: [the API](../../api/docs/sessions.md) starts with its server and stays; [`oqas --brief`](../../cli/docs/solo-command.md) hosts the session it opens. Both are given the store by `InstanceDatabase` of [`@open-qa-stack/store`](../../store/docs/database.md#the-database-of-an-instance-assembled), which assembles the database of an instance once for every process.

## Tests

The tests of the operations run the engine in a test repository made for each of them, with a store kept in memory, a model server that answers as scripted and doubles of npm and Playwright: no test calls a model. Those of several processes put two hosts on one store, whose clock the test holds, so that a silence lasts exactly as long as the test says. `pnpm exec vitest run --project engine` runs them alone.
