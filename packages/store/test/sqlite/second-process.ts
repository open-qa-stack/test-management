import { Database } from "../../src/database/database.ts";
import { DatabaseUrl } from "../../src/database/database-url.ts";
import { SessionStore } from "../../src/sessions/session-store.ts";

// A second process on the SQLite file of an instance: it says a number of messages to a session, one write
// each, while the process that started it writes to the same session. Started with the file, the identifier
// of the session and how many messages to say; it prints the numbers its messages were given.

const [file, session, count] = process.argv.slice(2) as [string, string, string];
const database = new Database(DatabaseUrl.ofFile(file), { log: () => undefined, warn: () => undefined });
try {
  const store = new SessionStore(database);
  const numbers: number[] = [];
  for (let said = 0; said < Number(count); said += 1) numbers.push((await store.say(session, `from the second process, ${said}`)).number);
  process.stdout.write(JSON.stringify(numbers));
} finally {
  await database.close();
}
