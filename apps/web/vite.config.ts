import { defineConfig } from "vite";

/** Where the API of the instance listens while the console is developed or previewed on this machine. */
const API = "http://127.0.0.1:8080";

/** What the console asks under `/api` goes to the API as it is: the API serves its routes there, on whichever address the console is. */
const proxy = { "/api": { target: API } };

export default defineConfig({ server: { proxy }, preview: { proxy } });
