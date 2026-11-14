import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exportFile } from "../src/common/source-export.ts";
import { fingerprintOf } from "../src/index.ts";
import type { ColumnSummary, DatabaseStructure, TableKeys } from "../src/postgresql/database-catalog.ts";
import { databaseExport } from "../src/postgresql/database-export.ts";

const column = (name: string, type: string, nullable = false): ColumnSummary => ({ name, type, nullable });

/** A base of three tables: one with keys, one that references itself, one the catalog gives no column of. */
function structure(premiumType = "numeric"): DatabaseStructure {
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
      [false, true, true],
    );
    assert.notEqual(after.fingerprint, before.fingerprint);
    assert.equal(databaseExport(structure()).fingerprint, before.fingerprint);
    assert.equal(before.fingerprint, fingerprintOf(before.elements.map((element) => element.fingerprint).join("\n")));
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
