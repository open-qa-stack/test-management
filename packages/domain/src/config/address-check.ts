/**
 * What the test of an address of an environment found — that of its interface or of one of its APIs —, without the
 * model and without writing anything. The address is said back without the name and the password it may carry.
 *
 * - `answers`: an HTTP answer came in time, whatever its status, which it gives.
 * - `malformed`: the address is no `http` or `https` address.
 * - `unknown-host`: no machine has the name of the address.
 * - `refused`: the machine refused the connection: nothing listens on its port.
 * - `timeout`: nothing answered in time.
 * - `unreachable`: the connection failed another way, which `code` names when the system tells it.
 */
export type AddressCheck =
  | { readonly state: "answers"; readonly url: string; readonly status: number }
  | { readonly state: "malformed"; readonly url: string }
  | { readonly state: "unknown-host"; readonly url: string }
  | { readonly state: "refused"; readonly url: string }
  | { readonly state: "timeout"; readonly url: string }
  | { readonly state: "unreachable"; readonly url: string; readonly code?: string };
