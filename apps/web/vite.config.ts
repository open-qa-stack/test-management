import { defineConfig } from "vite";

/** Where the API of the instance listens while the console is developed or previewed on this machine. */
const API = "http://127.0.0.1:8080";

/** What the console asks under `/api` goes to the API, as the reverse proxy of an instance does. */
const proxy = { "/api": { target: API, rewrite: (path: string) => path.replace(/^\/api/, "") } };

export default defineConfig({ server: { proxy }, preview: { proxy } });
