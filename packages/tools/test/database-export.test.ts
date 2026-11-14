import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exportFile } from "../src/common/source-export.ts";
import { fingerprintOf } from "../src/index.ts";
import type { ColumnSummary, DatabaseStructure, TableKeys, TriggerSummary } from "../src/postgresql/database-catalog.ts";
import { databaseExport } from "../src/postgresql/database-export.ts";

const column = (name: string, type: string, nullable = false): ColumnSummary => ({ name, type, nullable });

const trigger = (name: string, on: string, routine: string): TriggerSummary => ({
  name,
  definition: `CREATE TRIGGER ${name} BEFORE UPDATE ON ${on} FOR EACH ROW EXECUTE FUNCTION ${routine}`,
  routine,
});

/**
 * A base of three tables — one with keys that references itself, one the catalog gives no column of — a view and a
 * materialized view, without routines nor triggers unless some are given.
 */
function structure(premiumType = "numeric", more: Partial<Pick<DatabaseStructure, "routines" | "triggers">> = {}): DatabaseStructure {
  const keys: TableKeys[] = [
    {
      table: "public.policies",
      primaryKey: ["id"],
      foreignKeys: [
        { columns: ["customer_id"], references: "public.customers", referencedColumns: ["id"] },
        { columns: ["payer_id"], references: "public.customers", referencedColumns: ["id"] },
        { columns: ["replaces"], references: "public.policies", referencedColumns: ["id"] },
      ],
    },
    { table: "public.customers", primaryKey: ["country", "number"], foreignKeys: [] },
  ];
  return {
    tables: [
      { schema: "public", table: "policies" },
      { schema: "public", table: "customers" },
      { schema: "audit", table: "events" },
    ],
    columns: new Map([
      ["public.policies", [column("id", "bigint"), column("premium", premiumType, true), column("customer_id", "bigint")]],
      ["public.customers", [column("country", "text"), column("number", "integer")]],
    ]),
    keys: new Map(keys.map((key) => [key.table, key])),
    views: [
      {
        view: "public.open_policies",
        materialized: false,
        definition: " SELECT p.id,\n    c.number\n   FROM policies p\n     JOIN customers c ON c.number = p.customer_id;",
        columns: ["id", "number"],
        reads: ["public.customers", "public.policies"],
      },
      { view: "reporting.premiums", materialized: true, definition: " SELECT 1;", columns: [], reads: [] },
    ],
    routines: [],
    triggers: new Map(),
    ...more,
  };
}

describe("the export of a database", () => {
  it("writes the definition of each table again from the catalog: its columns, its primary key and its foreign keys", () => {
    const [policies, customers, events] = databaseExport(structure()).elements;
    assert.equal(
      policies!.definition,
      [
        "CREATE TABLE public.policies (",
        "  id bigint NOT NULL,",
        "  premium numeric,",
        "  customer_id bigint NOT NULL,",
        "  PRIMARY KEY (id),",
        "  FOREIGN KEY (customer_id) REFERENCES public.customers (id),",
        "  FOREIGN KEY (payer_id) REFERENCES public.customers (id),",
        "  FOREIGN KEY (replaces) REFERENCES public.policies (id)",
        ");",
      ].join("\n"),
    );
    assert.equal(
      customers!.definition,
      "CREATE TABLE public.customers (\n  country text NOT NULL,\n  number integer NOT NULL,\n  PRIMARY KEY (country, number)\n);",
    );
    assert.equal(events!.definition, "CREATE TABLE audit.events (\n);");
  });

  it("sums each table up in a few lines, without the lines it has nothing for", () => {
    const [policies, customers, events] = databaseExport(structure()).elements;
    assert.equal(
      policies!.summary,
      [
        "table public.policies",
        "  columns: id bigint not null, premium numeric, customer_id bigint not null",
        "  primary key: id",
        "  foreign keys: customer_id -> public.customers (id); payer_id -> public.customers (id); replaces -> public.policies (id)",
      ].join("\n"),
    );
    assert.equal(customers!.summary, "table public.customers\n  columns: country text not null, number integer not null\n  primary key: country, number");
    assert.equal(events!.summary, "table audit.events");
  });

  it("names each table, its columns, the other tables it references, each once, and its file", () => {
    const [policies, customers, events] = databaseExport(structure()).elements;
    assert.deepEqual(
      [policies!.name, policies!.kind, policies!.names, policies!.links, policies!.file],
      ["public.policies", "table", ["id", "premium", "customer_id"], ["public.customers"], "tables/public.policies.sql"],
    );
    assert.deepEqual([customers!.names, customers!.links], [["country", "number"], []]);
    assert.deepEqual([events!.names, events!.links, events!.file], [[], [], "tables/audit.events.sql"]);
  });

  it("fingerprints each table by its definition, and the base by its tables: a changed column changes its table alone", () => {
    const before = databaseExport(structure());
    const after = databaseExport(structure("integer"));
    assert.equal(before.elements[0]!.fingerprint, fingerprintOf(before.elements[0]!.definition));
    assert.deepEqual(
      before.elements.map((element, i) => element.fingerprint === after.elements[i]!.fingerprint),
      [false, true, true, true, true],
    );
    assert.notEqual(after.fingerprint, before.fingerprint);
    assert.equal(databaseExport(structure()).fingerprint, before.fingerprint);
    assert.equal(before.fingerprint, fingerprintOf(before.elements.map((element) => element.fingerprint).join("\n")));
  });
});

describe("the views of a database, exported after its tables", () => {
  it("gives the query of a view as the database writes it, its columns and the tables and views it reads", () => {
    const [, , , open, premiums] = databaseExport(structure()).elements;
    assert.deepEqual(open, {
      name: "public.open_policies",
      kind: "view",
      summary: "view public.open_policies\n  columns: id, number\n  reads: public.customers, public.policies",
      definition: "CREATE VIEW public.open_policies AS\n SELECT p.id,\n    c.number\n   FROM policies p\n     JOIN customers c ON c.number = p.customer_id;",
      names: ["id", "number"],
      links: ["public.customers", "public.policies"],
      file: "views/public.open_policies.sql",
      fingerprint: fingerprintOf(open!.definition),
    });
    assert.deepEqual(
      [premiums!.kind, premiums!.summary, premiums!.definition, premiums!.file],
      ["view", "materialized view reporting.premiums", "CREATE MATERIALIZED VIEW reporting.premiums AS\n SELECT 1;", "views/reporting.premiums.sql"],
    );
  });
});

describe("the routines of a database, exported after its views", () => {
  const routines = [
    {
      routine: "public.premium_of(policy_id bigint)",
      returns: "numeric",
      definition: "CREATE OR REPLACE FUNCTION public.premium_of(policy_id bigint)\n RETURNS numeric\n LANGUAGE sql\nRETURN 1\n",
      parameters: ["policy_id"],
    },
    {
      routine: "public.premium_of(policy_id bigint, at date)",
      returns: "numeric",
      definition: "CREATE OR REPLACE FUNCTION public.premium_of(policy_id bigint, at date)\n RETURNS numeric\n LANGUAGE sql\nRETURN 2\n",
      parameters: ["policy_id", "at"],
    },
    {
      routine: "public.close_policy(IN policy_id bigint)",
      definition: "CREATE OR REPLACE PROCEDURE public.close_policy(IN policy_id bigint)\n LANGUAGE sql\nAS $procedure$ SELECT 1 $procedure$\n",
      parameters: ["policy_id"],
    },
  ];

  it("gives the definition of a function or a procedure as the database writes it, what it returns and its parameters", () => {
    const [premium, , close] = databaseExport(structure("numeric", { routines })).elements.slice(5);
    assert.deepEqual(premium, {
      name: "public.premium_of(policy_id bigint)",
      kind: "routine",
      summary: "function public.premium_of(policy_id bigint) returns numeric",
      definition: "CREATE OR REPLACE FUNCTION public.premium_of(policy_id bigint)\n RETURNS numeric\n LANGUAGE sql\nRETURN 1",
      names: ["policy_id"],
      links: [],
      file: premium!.file,
      fingerprint: fingerprintOf(premium!.definition),
    });
    assert.deepEqual([close!.kind, close!.summary, close!.names], ["routine", "procedure public.close_policy(IN policy_id bigint)", ["policy_id"]]);
  });

  it("names two functions of one name with their arguments, each with its own file", () => {
    const [first, second] = databaseExport(structure("numeric", { routines })).elements.slice(5);
    assert.deepEqual([first!.name, second!.name], ["public.premium_of(policy_id bigint)", "public.premium_of(policy_id bigint, at date)"]);
    assert.match(first!.file, /^routines\/public\.premium_of_policy_id_bigint_-[0-9a-f]{8}\.sql$/);
    assert.match(second!.file, /^routines\/public\.premium_of_policy_id_bigint_at_date_-[0-9a-f]{8}\.sql$/);
    assert.notEqual(first!.fingerprint, second!.fingerprint);
  });
});

describe("the triggers of a database, exported with their table or their view", () => {
  const triggers = (stampRoutine = "public.stamp()") =>
    new Map([
      ["public.policies", [trigger("policies_audit", "public.policies", "audit.record()"), trigger("policies_stamp", "public.policies", stampRoutine)]],
      ["public.open_policies", [trigger("open_policies_stamp", "public.open_policies", "public.stamp()")]],
      ["public.customers", []],
    ]);

  it("adds the definition of each trigger to that of its table, names it in the summary, and links the table to the routine it runs", () => {
    const [policies, customers] = databaseExport(structure("numeric", { triggers: triggers() })).elements;
    const plain = databaseExport(structure()).elements;
    assert.equal(
      policies!.definition,
      [
        plain[0]!.definition,
        "",
        "CREATE TRIGGER policies_audit BEFORE UPDATE ON public.policies FOR EACH ROW EXECUTE FUNCTION audit.record();",
        "",
        "CREATE TRIGGER policies_stamp BEFORE UPDATE ON public.policies FOR EACH ROW EXECUTE FUNCTION public.stamp();",
      ].join("\n"),
    );
    assert.equal(policies!.summary, `${plain[0]!.summary}\n  triggers: policies_audit -> audit.record(); policies_stamp -> public.stamp()`);
    assert.deepEqual(policies!.links, ["public.customers", "audit.record()", "public.stamp()"]);
    assert.deepEqual(customers, plain[1]);
  });

  it("does the same for a view, and links an element once to a routine two of its triggers run", () => {
    const twice = new Map([
      ["public.open_policies", [trigger("a", "public.open_policies", "public.stamp()"), trigger("b", "public.open_policies", "public.stamp()")]],
    ]);
    const view = databaseExport(structure("numeric", { triggers: twice })).elements[3]!;
    assert.ok(
      view.definition.endsWith(
        ";\n\nCREATE TRIGGER a BEFORE UPDATE ON public.open_policies FOR EACH ROW EXECUTE FUNCTION public.stamp();\n\nCREATE TRIGGER b BEFORE UPDATE ON public.open_policies FOR EACH ROW EXECUTE FUNCTION public.stamp();",
      ),
    );
    assert.ok(view.summary.endsWith("\n  reads: public.customers, public.policies\n  triggers: a -> public.stamp(); b -> public.stamp()"));
    assert.deepEqual(view.links, ["public.customers", "public.policies", "public.stamp()"]);
  });

  it("changes the fingerprint of the table alone when one of its triggers changes", () => {
    const before = databaseExport(structure("numeric", { triggers: triggers() }));
    const after = databaseExport(structure("numeric", { triggers: triggers("public.stamp_again()") }));
    assert.deepEqual(
      before.elements.map((element, i) => element.fingerprint === after.elements[i]!.fingerprint),
      [false, true, true, true, true],
    );
    assert.notEqual(after.fingerprint, before.fingerprint);
  });
});

describe("the file of an exported element", () => {
  it("keeps a plain name, and gives any other a name no file system refuses, followed by a digest of the whole name", () => {
    assert.equal(exportFile("tables", "public.order_lines-2", "sql"), "tables/public.order_lines-2.sql");
    assert.match(exportFile("tables", "public.Orders", "sql"), /^tables\/public\.Orders-[0-9a-f]{8}\.sql$/);
    assert.notEqual(exportFile("tables", "public.Orders", "sql").toLowerCase(), exportFile("tables", "public.orders", "sql"));
    assert.match(exportFile("tables", "../../etc/passwd", "sql"), /^tables\/\.\._\.\._etc_passwd-[0-9a-f]{8}\.sql$/);
    assert.match(exportFile("tables", "public.côté client", "sql"), /^tables\/public\.c_t_client-[0-9a-f]{8}\.sql$/);
    assert.notEqual(exportFile("tables", "public.a b", "sql"), exportFile("tables", "public.a_b", "sql"));
    assert.notEqual(exportFile("tables", "public.a b", "sql"), exportFile("tables", "public.a/b", "sql"));
    const long = exportFile("tables", `public.${"a".repeat(200)}`, "sql");
    assert.match(long, /^tables\/public\.a{113}-[0-9a-f]{8}\.sql$/);
    assert.notEqual(long, exportFile("tables", `public.${"a".repeat(201)}`, "sql"));
  });
});
