import type { Command } from "./command.ts";

/** The address `oqas --ui` listens on unless it is given another: this machine alone. */
export const UI_HOST = "127.0.0.1";

/** The port `oqas --ui` listens on unless it is given another: the letters of `oqas` on the keys of a phone. */
export const UI_PORT = 6727;

const PORT_DIGITS = /^[0-9]{1,5}$/;

const UI_ALONE = "--ui serves the console, where the sessions are opened and followed: it takes --repository, --host and --port alone.";

/** What `--ui` asks for, or why it is refused: it goes with where it listens, and with nothing else. */
export function served(beside: boolean, host = UI_HOST, port = String(UI_PORT)): Command | string {
  if (beside) return UI_ALONE;
  if (!PORT_DIGITS.test(port) || Number(port) > 65535) return "--port needs an integer from 0 to 65535.";
  return { name: "ui", host, port: Number(port) };
}
