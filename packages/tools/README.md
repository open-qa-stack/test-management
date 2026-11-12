# @open-qa-stack/tools

The tools agents call during a session, outside the agent core. Every tool is a `ToolDefinition` of `@open-qa-stack/domain`: a name, a description written for the model, a JSON Schema for its arguments, `execute`, and `browserAction` when each call counts against the task's action limit. The harness runs any such tool; it depends on none of them.

| Folder | Tools |
|---|---|
| `src/browser/` | Explore and act on an application's user interface with Playwright — see [docs/browser-tools.md](docs/browser-tools.md). |
| `src/openapi/` | Read the operations of an OpenAPI contract. |
| `src/postgresql/` | Read the catalog and the data of a PostgreSQL database, read-only and bounded. |
| `src/document/` | Read a document of the test repository, section by section. |
| `src/source-code/` | List, search, read and outline the source code of an application in the languages of the tree-sitter build of VS Code (C#, Java, JavaScript, TypeScript, Python, Go, Rust, PHP, Ruby, C++…), and read its git history or run commands in it, as the configuration allows. |
| `src/common/` | What several kinds of tools share: tool names, files of the test repository. |

`browserTools(applications, access)` gives the browser tools of a session; `knowledgeTools(knowledge, access)` gives the tools of the declared knowledge sources — see [docs/knowledge-tools.md](docs/knowledge-tools.md). A new kind of tool gets its own folder and is exported from `src/index.ts`.
