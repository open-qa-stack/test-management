import { ApiClient } from "./api-client.ts";

/** The API of the instance that serves the console, on the origin of the page. */
export const api = new ApiClient(globalThis.fetch.bind(globalThis));
