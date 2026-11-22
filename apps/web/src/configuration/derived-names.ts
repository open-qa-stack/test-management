import type { OqasConfig } from "@open-qa-stack/domain/sessions";
import { changedAt, valueAt } from "./json-pointer.ts";

/**
 * Makes an identifier of a name: lower case letters and digits, separated by hyphens, accents left out.
 *
 * @param name - The name.
 * @returns The identifier; empty for a name without a letter or a digit.
 */
export function slugOf(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Makes the name of an environment variable of parts: upper case letters, digits and underscores.
 *
 * @param parts - The parts, such as an identifier and what the variable holds.
 * @returns The name.
 */
export function variableOf(...parts: readonly string[]): string {
  return parts
    .map((part) => slugOf(part).replace(/-/g, "_").toUpperCase())
    .filter((part) => part !== "")
    .join("_");
}

/** A field whose value follows another while the person did not set it: empty, or what it was made of the other before. */
interface Follower {
  /** The pointer of the field the person changed, which the follower follows: a pattern whose `*` are ranks. */
  readonly leader: RegExp;
  /** The pointer of the follower, from the pointer of the leader. */
  readonly follower: (leader: string) => string;
  /** What the follower is made of the draft, at the item of the leader. */
  readonly made: (draft: OqasConfig, leader: string) => string;
  /** Whether the item of the leader is one the configuration in force holds, whose follower stays as it is. */
  readonly saved: (inForce: OqasConfig | undefined, draft: OqasConfig, leader: string) => boolean;
}

/** The item of a pointer, from its parent pointer. */
const parentOf = (pointer: string): string => pointer.slice(0, pointer.lastIndexOf("/"));

/** The text at a pointer of a configuration; empty when it holds none. */
const textAt = (draft: OqasConfig | undefined, pointer: string): string => {
  const value = valueAt(draft, pointer);
  return typeof value === "string" ? value : "";
};

/** The application of a pointer under `/applications/<rank>`. */
const applicationOf = (pointer: string): string => /^\/applications\/\d+/.exec(pointer)![0];

/** The fields made of others: the identifier of an application of its name, the variables of a base and of an account. */
const FOLLOWERS: readonly Follower[] = [
  {
    leader: /^\/applications\/\d+\/name$/,
    follower: (leader) => `${parentOf(leader)}/id`,
    made: (draft, leader) => slugOf(textAt(draft, leader)),
    // An application in force keeps its identifier, which its sources and its tests name.
    saved: (inForce, draft, leader) => (inForce?.applications ?? []).some(({ id }) => id === textAt(draft, `${parentOf(leader)}/id`)),
  },
  {
    leader: /^\/knowledge\/\d+\/id$/,
    follower: (leader) => `${parentOf(leader)}/connectionStringEnv`,
    made: (draft, leader) => variableOf(textAt(draft, leader), "db", "url"),
    saved: (inForce, draft, leader) =>
      valueAt(draft, `${parentOf(leader)}/type`) !== "postgresql" || (inForce?.knowledge ?? []).some(({ id }) => id === textAt(draft, leader)),
  },
  {
    leader: /^\/applications\/\d+\/authentication\/accounts\/\d+\/name$/,
    follower: (leader) => `${parentOf(leader)}/usernameEnv`,
    made: (draft, leader) => variableOf(textAt(draft, `${applicationOf(leader)}/id`), textAt(draft, leader), "username"),
    saved: () => false,
  },
  {
    leader: /^\/applications\/\d+\/authentication\/accounts\/\d+\/name$/,
    follower: (leader) => `${parentOf(leader)}/passwordEnv`,
    made: (draft, leader) => variableOf(textAt(draft, `${applicationOf(leader)}/id`), textAt(draft, leader), "password"),
    saved: () => false,
  },
];

/**
 * Makes the fields that follow the one the person changed, while they did not set them: the identifier of an
 * application they add follows its name; the variable of the connection string of a base they add follows its
 * identifier; the variables of an account follow its name. A field the person set, or that the configuration in force
 * holds for its item, stays as it is.
 *
 * @param before - The draft before the change.
 * @param after - The draft after it.
 * @param changed - The pointer of the field the person changed.
 * @param inForce - The configuration in force.
 * @returns The draft after the change, the fields that follow it made.
 */
export function withFollowers(before: OqasConfig, after: OqasConfig, changed: string, inForce: OqasConfig | undefined): OqasConfig {
  return FOLLOWERS.filter(({ leader }) => leader.test(changed)).reduce((draft, { follower, made, saved }) => {
    const at = follower(changed);
    const current = textAt(draft, at);
    const followed = current === "" || current === made(before, changed);
    return followed && !saved(inForce, before, changed) ? changedAt(draft, at, made(draft, changed)) : draft;
  }, after);
}
