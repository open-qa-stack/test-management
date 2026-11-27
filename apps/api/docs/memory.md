# Memory of the agents

The memory of the agents is what they keep in mind from one task to the next. It holds two things:

- the **lessons** the people of the project give them: an instruction written in the memory, or a correction asked of a test and kept as an instruction;
- what the agents **noted** themselves while they worked, filed under a domain of the knowledge and a kind, which they recall as they need it.

A lesson is a rule the agents read as it is. It is kept to one application, or to the whole project when it names none. It is for the design of the tests (`design`), the discovery of the applications (`discovery`), or both (`all`). It applies while it is `active`. Before each task, every agent is given the active lessons of its work, each with the application it is kept to: the cartographer those of the discovery, the agents that plan, write and review the tests those of the design.

What an agent noted is for every work and every application. A person can reword it, or set it aside, and the agents then recall it no more. Nothing is removed from the memory: a line set aside is kept, and can be taken back.

| Route | Answer |
|---|---|
| `GET /api/memory` | The lines of the memory, the latest first, and how many are active and set aside: `{ items, counts: { active, inactive } }`, the type `MemoryList`. Each line, the type `MemoryItem`, gives its `type` (`instruction`, `correction` or `inferred`), its text, its application when it is kept to one, its target, whether it is active, when it was written, and, for what an agent noted, the domain, the kind and the role it is `filed` under. |
| `POST /api/memory` | Keeps an instruction — `{ text, application?, target, active? }`, a text of 600 characters at most, active unless `active` is `false` — and answers it as a line of the memory with `201`. |
| `PATCH /api/memory/<id>` | Changes a line — `{ text?, application?, target?, active? }`, one of them at least; `application: null` keeps a lesson to the whole project — and answers it as it stands. |

The shapes of the bodies are the types of `@open-qa-stack/domain/sessions`. Every answer is given with `cache-control: no-store`; every answer that is not a success is a [problem](sessions.md#problems).

## Problems

| `code` | Status | When |
|---|---|---|
| `invalid_request` | `400` | The body of a lesson has no text or one over 600 characters, a target that is none of `design`, `discovery` and `all`, or an `active` that is no boolean; the body of a change changes nothing, or one of its fields is not valid. |
| `unknown_memory` | `404` | The instance keeps no lesson nor memory of the identifier. The detail says to list them with `GET /memory`. |
| `memory_refused` | `409` | The application or the target of what an agent noted is asked to change: only what it says and whether it applies change. |
