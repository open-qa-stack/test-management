import { randomUUID } from "node:crypto";
import {
  MemoryRefusedError,
  UnknownMemoryError,
  type Lesson,
  type LessonDraft,
  type LessonStorePort,
  type Memory,
  type MemoryChange,
  type MemoryItem,
  type MemoryList,
  type MemoryStorePort,
} from "@open-qa-stack/domain";

/** The role a person corrects a memory of the agents under. */
const PERSON = "person";

/** A lesson as a line of the memory. */
function lessonItem({ id, kind, text, application, target, active, at }: Lesson): MemoryItem {
  return { id, type: kind, text, ...(application === undefined ? {} : { application }), target, active, at };
}

/** What an agent noted as a line of the memory: what it inferred, for every work. */
function memoryItem({ id, text, domain, kind, written, disabled }: Memory): MemoryItem {
  return { id, type: "inferred", text, target: "all", active: disabled !== true, at: written.at, filed: { domain, kind, role: written.role } };
}

/**
 * The operation on the memory of the agents: the lessons the people of the project give them, and what the agents noted
 * themselves while they worked, which a person reads, rewords, retargets and sets aside. Whatever shows the memory — the
 * console through the API, the command — calls it and holds no rule of its own.
 *
 * @remarks
 * A lesson is kept to an application or to the whole project, for the design of the tests, the discovery of the
 * applications or both, and is active or set aside. What an agent noted is for every work and every application: a
 * person changes only what it says and whether the agents recall it. Nothing is ever removed: a line set aside is kept.
 */
export class AgentMemory {
  readonly #lessons: LessonStorePort;
  readonly #memories: MemoryStorePort;
  readonly #now: () => Date;
  readonly #newId: () => string;

  /**
   * @param lessons - What keeps the lessons.
   * @param memories - What keeps what the agents noted.
   * @param now - The clock the lessons and the corrections are dated by.
   * @param newId - Gives the identifier of a new lesson.
   */
  constructor(lessons: LessonStorePort, memories: MemoryStorePort, now: () => Date = () => new Date(), newId: () => string = randomUUID) {
    this.#lessons = lessons;
    this.#memories = memories;
    this.#now = now;
    this.#newId = newId;
  }

  /** @returns The lessons and what the agents noted, the latest written first, and how many are active and set aside. */
  async list(): Promise<MemoryList> {
    const items = [...(await this.#lessons.list()).map(lessonItem), ...(await this.#memories.list({})).map(memoryItem)].sort(
      (left, right) => Number(left.at < right.at) - Number(left.at > right.at),
    );
    const active = items.filter((item) => item.active).length;
    return { items, counts: { active, inactive: items.length - active } };
  }

  /**
   * Keeps an instruction a person gives the agents.
   *
   * @param draft - What it says, where, for what, and whether it applies.
   * @returns It, as a line of the memory.
   */
  async add(draft: LessonDraft): Promise<MemoryItem> {
    const lesson: Lesson = { id: this.#newId(), kind: "instruction", ...draft, at: this.#now().toISOString() };
    await this.#lessons.add(lesson);
    return lessonItem(lesson);
  }

  /**
   * Changes a line of the memory as a person asks.
   *
   * @param id - The identifier of a lesson, or of what an agent noted.
   * @param change - What changes.
   * @returns The line as it stands.
   * @throws UnknownMemoryError when the instance keeps none of the identifier.
   * @throws MemoryRefusedError when the application or the work of what an agent noted is asked to change.
   */
  async change(id: string, change: MemoryChange): Promise<MemoryItem> {
    const lesson = (await this.#lessons.list()).find((kept) => kept.id === id);
    if (lesson !== undefined) {
      const { application: _, ...rest } = lesson;
      const application = change.application === undefined ? lesson.application : (change.application ?? undefined);
      const changed: Lesson = {
        ...rest,
        ...(application === undefined ? {} : { application }),
        text: change.text ?? lesson.text,
        target: change.target ?? lesson.target,
        active: change.active ?? lesson.active,
      };
      await this.#lessons.set(changed);
      return lessonItem(changed);
    }
    const memory = (await this.#memories.list({})).find((kept) => kept.id === id);
    if (memory === undefined) throw new UnknownMemoryError(id);
    if (change.application !== undefined || change.target !== undefined)
      throw new MemoryRefusedError(`What an agent noted is for every work and every application: only what it says and whether it applies change.`);
    if (change.text !== undefined)
      await this.#memories.revise(
        id,
        { text: change.text, tags: memory.tags, ...(memory.source === undefined ? {} : { source: memory.source }) },
        { role: PERSON, task: "memory", at: this.#now().toISOString() },
      );
    if (change.active !== undefined) await this.#memories.enable(id, change.active);
    return memoryItem((await this.#memories.list({})).find((kept) => kept.id === id)!);
  }
}
