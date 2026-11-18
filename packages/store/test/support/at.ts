/** The date of what the tests write: some seconds after 09:00 on one day. */
export function at(seconds: number): string {
  return new Date(Date.parse("2026-11-14T09:00:00.000Z") + seconds * 1000).toISOString();
}
