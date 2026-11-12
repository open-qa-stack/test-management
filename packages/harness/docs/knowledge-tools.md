# Knowledge tools

`knowledgeTools(knowledge, access)` gives each knowledge source of the configuration its own tools, and only its own. A session offers them next to its other tools; none counts as a browser action.

| Source | Tools | What they do |
|---|---|---|
| `openapi` | `<id>_list_operations`, `<id>_read_operation` | List the operations of the contract (method, path, identifier, summary); return one operation as the contract describes it. |
| `postgresql` | `<id>_list_tables`, `<id>_describe_table`, `<id>_sample_rows`, `<id>_search`, `<id>_query` | List the tables by schema; list the columns of a table (name, type, nullable); return the first rows of a table; return the rows of a table where a text column contains a value; run one read query. |
| `document` | `<id>_list_sections`, `<id>_read_section` | List the sections of the document (number, level, title); return the text of one section by its number. |

`<id>` is the identifier of the source, with hyphens turned into underscores: the contract `policy-api` gives `policy_api_list_operations`.

## Bounds

- A contract tool reads the contract the source declares: fetched at its URL, within ten seconds and without following redirects, or read from the test repository. It is loaded on first use and kept; a failed load is tried again on the next call. An operation is returned with the parameters of its path and its local `$ref` resolved.
- The catalog tools run fixed queries on `information_schema` only, and a guard refuses any other text; table and schema names reach the database as parameters.
- The data tools read rows. A sample or a search only touches a table the catalog knows, with quoted identifiers, and the searched value reaches the database as a parameter. A free query must be a single `SELECT` or `WITH`, with no semicolon but a trailing one, even inside a string: it becomes a subquery that the harness bounds. It is refused when the role of the connection can reach the database server — a superuser, or a member of `pg_read_server_files`, `pg_write_server_files` or `pg_execute_server_program` — and when two of its columns share a name. Declare a connection with a role that has none of these rights to use it.
- Rows are bounded (20 by default, 100 at most). Every value is read as text and cut by the database itself to 300 characters, so that a large value never leaves the server; the answer says when rows or values were cut.
- Every query opens a connection, runs in a read-only transaction with a five-second statement timeout, is rolled back and closes the connection: no tool can write. The connection string is read from the environment variable the source names, when a query runs, and never appears in an error.
- The platform only tests applications outside production: a declared database is a test database. The configuration cannot check it.
- A document tool takes no path: it reads the one file the source declares. The file is resolved with its symbolic links and must stay inside the test repository. Headings inside fenced code blocks are not sections.

## Failures

A source that cannot be reached, or a database whose connection string is not set, fails the call and not the session: the agent receives the error and may go on. An operation, a section or a table that does not exist is answered with an error the agent can read. `knowledgeTools` gives tools to every source it receives: choosing the sources of a session from their attachments is up to the caller.
