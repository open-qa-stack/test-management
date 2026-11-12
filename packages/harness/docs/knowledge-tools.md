# Knowledge tools

`knowledgeTools(knowledge, access)` gives each knowledge source of the configuration its own tools, and only its own. A session offers them next to its other tools; none counts as a browser action.

| Source | Tools | What they do |
|---|---|---|
| `openapi` | `<id>_list_operations`, `<id>_read_operation` | List the operations of the contract (method, path, identifier, summary); return one operation as the contract describes it. |
| `postgresql` | `<id>_list_tables`, `<id>_describe_table` | List the tables by schema; list the columns of a table (name, type, nullable). |
| `document` | `<id>_list_sections`, `<id>_read_section` | List the sections of the document (number, level, title); return the text of one section by its number. |

`<id>` is the identifier of the source, with hyphens turned into underscores: the contract `policy-api` gives `policy_api_list_operations`.

## Bounds

- A contract tool reads the contract the source declares: fetched at its URL, within ten seconds and without following redirects, or read from the test repository. It is loaded on first use and kept; a failed load is tried again on the next call. An operation is returned with the parameters of its path and its local `$ref` resolved.
- A database tool reads the catalog only (`information_schema`), never a row of data. It runs two fixed queries, and a guard refuses any other text before it reaches the database; table and schema names reach it as parameters. Each query opens a connection, runs in a read-only transaction with a five-second statement timeout, is rolled back and closes the connection. The connection string is read from the environment variable the source names, when a query runs, and never appears in an error.
- A document tool takes no path: it reads the one file the source declares. The file is resolved with its symbolic links and must stay inside the test repository. Headings inside fenced code blocks are not sections.

## Failures

A source that cannot be reached, or a database whose connection string is not set, fails the call and not the session: the agent receives the error and may go on. An operation, a section or a table that does not exist is answered with an error the agent can read. `knowledgeTools` gives tools to every source it receives: choosing the sources of a session from their attachments is up to the caller.
