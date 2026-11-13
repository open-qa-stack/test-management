import { randomBytes } from "node:crypto";
import pg from "pg";

/** A database of its own, created empty on the test server and dropped after use. */
export interface IsolatedDatabase {
  /** Its connection URL, with the credentials of the test server. */
  readonly url: string;
  /** Drops the database, closing whatever connection is still open to it. */
  drop(): Promise<void>;
}

function server(): string {
  const url = process.env["OQAS_TEST_DATABASE_URL"];
  if (url === undefined || url === "") throw new Error("OQAS_TEST_DATABASE_URL is not set: run the tests through the test script of the package.");
  return url;
}

async function onServer(statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: server() });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

/** @returns A new, empty database, which no other test file sees. */
export async function isolatedDatabase(): Promise<IsolatedDatabase> {
  const name = `oqas_test_${randomBytes(6).toString("hex")}`;
  await onServer(`create database ${name}`);
  const url = new URL(server());
  url.pathname = `/${name}`;
  return { url: url.href, drop: () => onServer(`drop database if exists ${name} with (force)`) };
}
