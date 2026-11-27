import type { LessonDraft, MemoryChange, MemoryItem, MemoryList } from "@open-qa-stack/domain/sessions";
import type { Api } from "../built-console.ts";
import { ConfiguredInstance } from "../configuration/configured-instance.ts";
import { MEMORY } from "./memory-fixture.ts";

/** The API of an instance whose agents keep the memory of the fixtures in mind, beside the configuration and the sessions of a configured instance. */
export class MemorizedInstance {
  /** The configuration and the sessions of the instance. */
  public readonly configured = new ConfiguredInstance();

  /** The lines of the memory. */
  public items: MemoryItem[] = [...MEMORY.items];

  /** What the console sent, in order: the instructions added, and the changes of a line with the line they are of. */
  public readonly sent: (LessonDraft | { readonly id: string; readonly change: MemoryChange })[] = [];

  /** The code the instance refuses the next change with, once; none to take it. */
  public refusal: string | undefined;

  /** The memory, counted. */
  #list(): MemoryList {
    const active = this.items.filter((item) => item.active).length;
    return { items: this.items, counts: { active, inactive: this.items.length - active } };
  }

  /** Takes a change, or refuses it once when the test asks it. */
  #taken(kept: () => MemoryItem): { status: number; body: string } {
    const refusal = this.refusal;
    this.refusal = undefined;
    if (refusal !== undefined) return { status: 409, body: JSON.stringify({ code: refusal, detail: "No." }) };
    return { status: 200, body: JSON.stringify(kept()) };
  }

  public readonly api: Api = (request) => {
    if (request.path === "/api/memory" && request.method === "GET") return { status: 200, body: JSON.stringify(this.#list()) };
    if (request.path === "/api/memory" && request.method === "POST")
      return this.#taken(() => {
        const draft = JSON.parse(request.body!) as LessonDraft;
        this.sent.push(draft);
        const item: MemoryItem = { id: `l${this.items.length + 1}`, type: "instruction", ...draft, at: "2026-11-27T12:00:00.000Z" };
        this.items = [item, ...this.items];
        return item;
      });
    const id = /^\/api\/memory\/([^/]+)$/.exec(request.path)?.[1];
    if (id !== undefined)
      return this.#taken(() => {
        const change = JSON.parse(request.body!) as MemoryChange;
        this.sent.push({ id, change });
        const { application, ...rest } = change;
        this.items = this.items.map((item) =>
          item.id === id ? { ...item, ...rest, ...(application === null || application === undefined ? {} : { application }) } : item,
        );
        return this.items.find((item) => item.id === id)!;
      });
    return this.configured.api(request);
  };
}
