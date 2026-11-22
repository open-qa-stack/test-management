# Knowledge tools

`knowledgeTools(knowledge, access)` gives each knowledge source of the configuration its own tools, and only its own. A session offers them next to its other tools; none counts as a browser action.

| Source | Tools | What they do |
|---|---|---|
| `openapi` | `<id>_list_operations`, `<id>_read_operation` | List the operations of the contract (method, path, identifier, summary); return one operation as the contract describes it. |
| `postgresql` | `<id>_list_tables`, `<id>_describe_table`, `<id>_sample_rows`, `<id>_search`, `<id>_query` | List the tables by schema; list the columns of a table (name, type, nullable); return the first rows of a table; return the rows of a table where a text column contains a value; run one read query. |
| `document` | `<id>_list_files`, `<id>_list_sections`, `<id>_read_section`, `<id>_read_file`, `<id>_search` | Go through the documents by levels: list what one folder holds; list the sections of a document without its text; return the text of a section, or of a document; find the lines that hold a text. See [Documents](#documents). |
| `logs` | `<id>_read_logs` | Return the lines the service logged from an instant, the start of the task by default, those that contain a text if one is given. |
| `source-code` | `<id>_list_files`, `<id>_search`, `<id>_read_file`, `<id>_outline`; with `commands` at `git` (the default) or `shell`, `<id>_git_log`, `<id>_git_blame`, `<id>_git_show`; with `shell`, `<id>_run_command` | List the files of the folder, by glob; find a text or a regular expression, with the lines around each match; return numbered lines of a file; list the declarations and the web routes of a source file; read the latest commits, the blame of a few lines, one commit; run a shell command. |

`<id>` is the identifier of the source, with hyphens turned into underscores: the contract `policy-api` gives `policy_api_list_operations`.

## Bounds

- A contract tool reads the contract the source declares: fetched at its URL, within ten seconds and without following redirects, or read from the test repository. It is loaded on first use and kept; a failed load is tried again on the next call. An operation is returned with the parameters of its path and its local `$ref` resolved.
- The catalog tools run fixed queries on the catalog only, `information_schema` and `pg_catalog`, and a guard refuses any other text; table and schema names reach the database as parameters. The tables an extension installed are not listed.
- The data tools read rows. A sample or a search only touches a table the catalog knows, with quoted identifiers, and the searched value reaches the database as a parameter; its rows give the columns of the primary key first, then the others in the order of the table. A free query must be a single `SELECT` or `WITH`, with no semicolon but a trailing one, even inside a string: it becomes a subquery that the harness bounds. It is refused when the role of the connection can reach the database server — a superuser, or a member of `pg_read_server_files`, `pg_write_server_files` or `pg_execute_server_program` — and when two of its columns share a name. Declare a connection with a role that has none of these rights to use it. A free query the database refuses because it names a column or a table it does not have fails with an error that ends with `Call <id>_describe_table for the exact names.`
- Rows are bounded (20 by default, 100 at most). Every value is read as text and cut by the database itself to 300 characters, so that a large value never leaves the server; the answer says when rows or values were cut.
- Every query opens a connection, runs in a read-only transaction with a five-second statement timeout, is rolled back and closes the connection: no tool can write. The connection string is read from the environment variable the source names, when a query runs, and never appears in an error.
- The platform only tests applications outside production: a declared database is a test database. The configuration cannot check it.
- A document tool takes no path: it reads the one file the source declares. The file is resolved with its symbolic links and must stay inside the test repository. Headings inside fenced code blocks are not sections.
- A source code folder may be outside the test repository. Its reading and git tools never leave it: every path an agent gives is resolved with its symbolic links and must stay inside the folder. Listings and searches skip symbolic links, hidden folders and the folders of dependencies and builds (`node_modules`, `target`, `dist`, `build`, `out`, `coverage`), and look at 20,000 files at most. A glob may not exceed 200 characters nor its braces 64 alternatives; it is matched without regular expressions.
- A listing returns 200 files unless the agent asks for up to 500; a search 30 matches, up to 100, with two lines around each, up to five, its lines cut beyond 300 characters; a read 400 lines, cut beyond 2,000 characters. Files larger than a megabyte, and binary files, are neither read nor searched: a search lists them as skipped. Lines are numbered as git and editors number them.
- A search runs in a worker thread stopped after ten seconds, so that a regular expression that backtracks without end cannot stall the session.
- The outline parses the file with tree-sitter, the parser editors use, through the grammars of the tree-sitter build of VS Code: C#, Java, JavaScript (Flow included, read by the TSX grammar when it fits better), TypeScript and TSX, Python, Go, Rust, PHP, Ruby, C++ (C files read by its grammar), Bash and PowerShell. Files in other languages — VB.NET, F#, Razor, Kotlin, Swift, Scala… — have no outline, and can still be searched and read.
- It gives classes, records, structures, interfaces, traits, enums and type aliases, functions and methods, functions held by variables, class fields, assignments or wrapping calls included, each on the line of its name. It gives the routes too: the attributes, annotations and decorators that map a request to a declaration (ASP.NET, Spring, JAX-RS, NestJS, FastAPI, Flask, Symfony, actix…), just before it, and the calls that declare one (ASP.NET minimal APIs, Express, Go `net/http` and gin, Django, Rails, Laravel…). A call with a common name such as `get` counts as a route only when given a path that starts with `/`, or in the Rails routing language. The outline gives 300 declarations at most, the first ones, and says when there are more.
- The git tools run `git log`, `git blame` and `git show` only, without a shell, in the folder, limited to the folder's paths, for ten seconds at most. The pager, file system monitor, signature checks, hooks, external diffs and text conversions the repository may declare are turned off, system and global git settings are ignored, paths are taken literally, and the blame reads the committed file rather than the working tree, so that git runs no other program. A commit is named by its hash, `HEAD` or `HEAD~n`, and must be a commit. An output longer than 20,000 characters ends with `[output cut]`.
- The log tool reads the one log the source declares, and takes no path nor command. A line belongs to the instant it starts with, ISO 8601 or as most loggers write it (`2026-11-13 10:15:00,123`), in local time without an offset, and covers the span its precision leaves: a line stamped `10:15:00` is read from any instant until `10:15:00.999`. A line that starts with none, as a line of a stack trace, belongs to the last that did, and lines before the first instant are left out. The agent gives an instant (by default the start of the task, `taskStart` of the access, or when the tools were made), a text to find, ignoring case, and a number of lines (100 by default, 500 at most). Colour escapes are removed. A reading stops at that number or at 20,000 characters, cuts lines beyond 2,000 characters, and says when lines were left out.
- A log file is read a line at a time from its start, so that a large file is never held whole. A container is read by `<engine> logs --timestamps --since <instant> -- <container>`, without a shell, for ten seconds at most and ten megabytes of each output: the instant is written by the harness from the date it parsed, the filter is applied by the tool, and no text of the agent reaches the command. Standard and error outputs are merged in the order of their timestamps. The engine receives `PATH`, `HOME` and the variables that tell it how to reach its service (`XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `CONTAINER_HOST`, `CONTAINER_CONNECTION`, `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_CONFIG`), and no other.
- The log tool masks the values `secrets` of the access gives — every value of the environment variables the configuration names, as `declaredValues` of `@open-qa-stack/domain` lists them — in every line and every error, in the forms they take in text, JSON and URLs, before it filters: a filter cannot tell whether a secret is there. A caller that gives none masks nothing.
- `run_command` exists only when the source declares `commands: "shell"`. It runs `/bin/sh -c` in the folder, for thirty seconds at most, with the rights of the user who runs the agents: it can write, and read outside the folder. Commands receive `PATH` and, for git, the variables that turn off its system and global settings, as their only environment: the harness's keys and connection strings are not passed to them, though a shell command can read whatever the user can. Outputs are cut beyond 20,000 characters.

## Failures

A source that cannot be reached, or a database whose connection string is not set, fails the call and not the session: the agent receives the error and may go on. An operation, a section or a table that does not exist is answered with an error the agent can read. A missing folder fails the call, and is looked for again at the next one. A missing log file, an engine that is not installed, does not answer in time or cannot read the container, fails the call with its reason. A stopped container still has its logs, and the tool reads them. `knowledgeTools` gives tools to every source it receives: choosing the sources of a session from their attachments is up to the caller.

## What a source describes

The tools of a source attached to applications name them in their description. Given `applications`, those the session tests, the tools of a source attached to none of them answer `{ warning, result }`: the warning names the applications of the source and those of the session, and asks the agent to check that what it looks for is the same before it relies on it (`withReach`). The source stays readable: what it tells of another application may hold for this one. A source of the whole project says nothing of the kind.

## Export of a database

`knowledgeInventory(source, access)` reads what a source holds without the model. For a `postgresql` source it reads the catalog once and returns, with the inventory, the `export` of the database: its elements, tables first, then views, then functions and procedures, each with a `name`, a `kind`, a `summary` of a few lines, its whole `definition`, the `names` it declares, the `links` to the other elements it refers to, the `file` of its definition in the export and a `fingerprint`.

| Kind | Name | Definition | Summary | Names | Links | File |
|---|---|---|---|---|---|---|
| `table` | `schema.table` | A `CREATE TABLE` written again from the catalog: columns with their whole type, their default and `NOT NULL`, primary key, foreign keys, unique, check and exclusion constraints; then the indexes no constraint made, as `pg_get_indexdef` writes them | Columns, primary key, foreign keys, constraints, names of the indexes | Its columns | The other tables its foreign keys reference | `tables/<name>.sql` |
| `view` | `schema.view` | `CREATE VIEW` or `CREATE MATERIALIZED VIEW`, then its query as `pg_get_viewdef` writes it | Whether it is materialized, columns, the tables and views it reads | Its columns | The tables and views it reads, as PostgreSQL records them | `views/<name>.sql` |
| `routine` | `schema.name(arguments)`, with the arguments that tell it from the others of its name, as `pg_get_function_identity_arguments` writes them | The definition `pg_get_functiondef` writes | `function` and what it returns, or `procedure` | Its parameters that have a name | None | `routines/<name>.sql` |

- PostgreSQL keeps no text of a table. Its definition is there to be read, not run: names are written as the catalog gives them, unquoted. A type is written whole, as `format_type` gives it (`character varying(255)`, `numeric(10,2)`, `text[]`); a column that has a default, an identity or a generation expression has its clause; a constraint is written as `pg_get_constraintdef` gives it. Storage options, ownership, privileges, comments and partitioning are not in it. The indexes of a materialized view follow its query the same way.
- The triggers of a table or of a view are no elements. The definition of each, as `pg_get_triggerdef` writes it, follows that of its table; the summary of the table names each with the routine it runs, and that routine is among its links. The triggers PostgreSQL makes for its own constraints are left out.
- The tables, views and routines of the catalog itself and those an extension installed are left out; aggregates and window functions are no routines here. A link may still name what the export leaves out, such as the routine of an extension a trigger runs.
- A definition is exported as the database gives it. The caller masks the secrets it knows when it writes the export; a password or a key written in the body of a routine or in the query of a view is not one of them.
- PostgreSQL writes the query of a view with the names the connection sees without their schema, so the text depends on the `search_path` of the role; it records no dependency on a table of its own catalog, so a view that reads only `pg_catalog` reads nothing here.
- The inventory lists the tables and the views, the elements of the card of the database, and not the routines, which are in the export only. The fingerprint of the inventory is that of the export: a routine or a trigger that changes changes it.
- The fingerprint of an element is `sha256:` and a digest of its definition; that of the database covers the fingerprints of its elements, in the order of the export. A change to one element changes its fingerprint and that of the database, and no other.
- A name of lower-case letters, digits, dots, hyphens and underscores, 120 characters at most, names its file as it is. Any other has its other characters replaced by underscores, is cut to 120 characters and is followed by a digest of the whole name, so that no file leaves its folder and two elements never share one, even on a file system that ignores case.

## Export of a contract

For an `openapi` source, `knowledgeInventory` loads the contract once and returns, with the inventory, its `export`: one element per operation, then one per named schema, in the order of the document.

| Element | Name | Summary | Names | Links | File |
|---|---|---|---|---|---|
| Operation | `METHOD /path` | Its title, its identifier, its tags, its parameters with where each goes and whether it is required, the schemas of its body and, for each response, its status and its schemas | Its identifier and its parameters | The schemas of the contract it refers to | `operations/<name>.json` |
| Schema | Its name in `components.schemas`, or in `definitions` | Its properties with their types, those required, and the values of an enumeration | Its properties | The other schemas it refers to | `schemas/<name>.json` |

The definition of an element is what the contract writes of it, as JSON. An operation holds the parameters of its path, the ones it redefines once, and a parameter given by a local `$ref` is the one it points to; every other `$ref` is kept, since a schema is read in its own element. A schema named in both `components.schemas` and `definitions` is exported once, as the first writes it. The inventory holds the operations only, each with its kind, its identifier and its tags as facts; its fingerprint is that of the export, so that it changes when an operation or a schema does.

## Documents

A `document` source is one file, or a folder of them. A source declared as a file is that file, read as Markdown whatever its extension. A source declared as a folder is every Markdown file under it, `.md` or `.markdown`; the other files are listed apart and never read. A document is read as its sections whatever its format: another format needs its reader only. No path leaves the source, and the source stays inside the test repository.

The tools let an agent go by levels instead of reading everything:

| Tool | Arguments | Returns |
|---|---|---|
| `<id>_list_files` | `folder`, the root when left out | The folders of that folder, each with how many documents are under it; its documents, each with its title, its number of headings and its length; the files no reader reads; `truncated` when the folder was too large to be looked at whole |
| `<id>_list_sections` | `file` | The headings of the document, without its text: number, level, title and length of each section |
| `<id>_read_section` | `file`, `number` | The text of the section, with the sections it holds |
| `<id>_read_file` | `file` | The whole text of the document |
| `<id>_search` | `text` | The lines that hold the text, whatever its case, 30 at most: each with its document, and the number and the title of the deepest section that holds it |

`file` may be left out when the source is one document. A text longer than 20,000 characters is cut, with how to read the rest section by section.

`knowledgeInventory` gives the documents of the source, each by its path with its title, its number of headings and its length as facts, and the fingerprint of their paths and texts. It exports nothing: which document, which section is worth an element is for the agent that maps the source to say.

## The reference of Playwright

`PlaywrightReference.load(repositoryRoot)` reads the reference of the API of Playwright from the packages a test repository installs: the type files `playwright-core/types/types.d.ts` and `playwright/types/test.d.ts` document every member of every interface, and `@playwright/test/package.json` gives the version. It is the reference of the version the tests run with. A repository that installs no Playwright has an empty one.

`playwrightTools(reference)` gives two tools, whose descriptions name the version:

| Tool | What it returns |
|---|---|
| `playwright_search` | The members that echo words — in their name, which counts more, their description or their options —, fifteen at most, each with its name, such as `Locator.filter`, and the first sentence of its description. |
| `playwright_read` | One member whole: its description, how it is declared and each of its options, cut past 8,000 characters. The forms of a method are one member. A name the reference does not have is answered with an error that says so and names the closest members. |

