import { randomBytes } from "node:crypto";
import pg from "pg";
import type { TestDatabase } from "./test-database.ts";

function server(): string {
  const url = process.env["OQAS_TEST_DATABASE_URL"];
  if (url === undefined || url === "") throw new Error("OQAS_TEST_DATABASE_URL is not set: run the tests through the test script of the package.");
  return url;
}

/** Runs statements on the test server, and answers the rows of the last. */
async function onServer(...statements: string[]): Promise<unknown[]> {
  const client = new pg.Client({ connectionString: server() });
  await client.connect();
  try {
    let rows: unknown[] = [];
    for (const statement of statements) ({ rows } = await client.query(statement));
    return rows;
  } finally {
    await client.end();
  }
}

/** The name of the database a URL of the test server leads to. */
const nameOf = (url: string): string => new URL(url).pathname.slice(1);

/** @returns A new, empty database of the PostgreSQL test server, which no other test file sees. */
export async function isolatedDatabase(): Promise<TestDatabase> {
  const name = `oqas_test_${randomBytes(6).toString("hex")}`;
  await onServer(`create database ${name}`);
  const url = new URL(server());
  url.pathname = `/${name}`;
  return {
    url: url.href,
    drop: async () => {
      await onServer(`drop database if exists ${name} with (force)`);
    },
  };
}

/**
 * Makes a database of the test server refuse connections and closes those that are open, as a server that goes
 * away does; its data stays.
 *
 * @param url - The connection URL of the database.
 */
export async function refuseConnections(url: string): Promise<void> {
  const name = nameOf(url);
  await onServer(`alter database ${name} allow_connections false`, `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${name}'`);
}

/**
 * Makes a database of the test server accept connections again.
 *
 * @param url - The connection URL of the database.
 */
export async function acceptConnections(url: string): Promise<void> {
  await onServer(`alter database ${nameOf(url)} allow_connections true`);
}

/**
 * @param url - The connection URL of a database of the test server.
 * @returns How many connections to it listen for notifications.
 */
export async function listeningConnections(url: string): Promise<number> {
  const listening = await onServer(`select 1 from pg_stat_activity where datname = '${nameOf(url)}' and query ilike 'listen%'`);
  return listening.length;
}
