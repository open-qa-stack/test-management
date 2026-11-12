/** Raised by any network access the tests refuse. */
export class NetworkAccessError extends Error {}

/** Port of a local model server such as LM Studio; never reachable from the tests. */
export const MODEL_SERVER_PORT = 1234;
